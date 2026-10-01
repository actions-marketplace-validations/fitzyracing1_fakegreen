import { ResolvedConfig } from './config';
import { filePath } from './diff';
import { matchesAny } from './glob';
import { fileKind, findDirective, flavorOf, Flavor, isConfigFile, isTestPath, isTestSupportPath, langOf, lexLine, newLexState } from './lang';
import { DiffLine, FileDiff, FileKind, Finding, Hunk, Lang, Severity } from './types';

export interface FileCtx {
  path: string;
  diff: FileDiff;
  lang: Lang;
  kind: FileKind;
  flavor: Flavor;
  isTest: boolean;
  isTestSupport: boolean;
  isConfig: boolean;
  added: DiffLine[];
  removed: DiffLine[];
  /** `fakegreen-ignore-file` seen in the diff for this file. */
  ignoreFile: boolean;
}

export interface ScanCtx {
  files: FileCtx[];
  config: ResolvedConfig;
  /** Multiset of trimmed removed lines across the whole diff (to detect moved code). */
  removedText: Map<string, number>;
  addedText: Map<string, number>;
}

export interface Draft {
  ruleId: string;
  severity: Severity;
  file: FileCtx;
  line?: DiffLine;
  /** Explicit line number when no DiffLine anchor is appropriate. */
  lineNo?: number;
  hunk?: Hunk;
  side: Finding['side'];
  message: string;
  snippet?: string;
}

export function buildContext(diffs: FileDiff[], config: ResolvedConfig): ScanCtx {
  const files: FileCtx[] = [];
  const removedText = new Map<string, number>();
  const addedText = new Map<string, number>();
  for (const d of diffs) {
    if (d.binary) continue;
    const p = filePath(d);
    if (matchesAny(p, config.ignore)) continue;
    const kind = fileKind(p);
    if (kind === 'skip') continue;
    const lang = langOf(p);
    const flavor = flavorOf(p, lang, kind);
    const ctx: FileCtx = {
      path: p,
      diff: d,
      lang,
      kind,
      flavor,
      isTest: isTestPath(p, config.testPatterns) || (d.oldPath ? isTestPath(d.oldPath, config.testPatterns) : false),
      isTestSupport: isTestSupportPath(p),
      isConfig: isConfigFile(p),
      added: [],
      removed: [],
      ignoreFile: false,
    };
    for (const h of d.hunks) {
      // Lex old side and new side independently so multi-line state is tracked per side.
      const oldSt = newLexState();
      const newSt = newLexState();
      for (const l of h.lines) {
        if (l.kind === '-') {
          Object.assign(l, lexLine(l.text, lang, flavor, oldSt));
        } else if (l.kind === '+') {
          Object.assign(l, lexLine(l.text, lang, flavor, newSt));
        } else {
          Object.assign(l, lexLine(l.text, lang, flavor, newSt));
          lexLine(l.text, lang, flavor, oldSt);
        }
        if (l.kind === '+') ctx.added.push(l);
        if (l.kind === '-') ctx.removed.push(l);
        if (l.kind !== '-' && findDirective(flavor === 'none' ? l.text : (l.comment ?? ''))?.file) ctx.ignoreFile = true;
      }
    }
    for (const l of ctx.removed) bump(removedText, norm(l.text));
    for (const l of ctx.added) bump(addedText, norm(l.text));
    files.push(ctx);
  }
  return { files, config, removedText, addedText };
}

export function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function bump(m: Map<string, number>, k: string) {
  if (!k) return;
  m.set(k, (m.get(k) ?? 0) + 1);
}

/** True if this added line also appears verbatim as a removed line somewhere in the diff (moved code). */
export function isMovedLine(ctx: ScanCtx, l: DiffLine): boolean {
  const k = norm(l.text);
  if (!k) return false;
  if (l.kind === '+') return (ctx.removedText.get(k) ?? 0) > 0;
  return (ctx.addedText.get(k) ?? 0) > 0;
}

/** New-side lines of a hunk (context + added) in order. */
export function newSide(h: Hunk): DiffLine[] {
  return h.lines.filter((l) => l.kind !== '-');
}

export function* hunksOf(f: FileCtx): Generator<Hunk> {
  yield* f.diff.hunks;
}

/** Find the hunk containing a given line object. */
export function hunkOf(f: FileCtx, line: DiffLine): Hunk | undefined {
  return f.diff.hunks.find((h) => h.lines.includes(line));
}

/** Anchor line number for a removed line: the next new-side line in its hunk, else the hunk start. */
export function anchorFor(f: FileCtx, line: DiffLine): number | undefined {
  if (line.newNo !== undefined) return line.newNo;
  if (f.diff.status === 'deleted') return line.oldNo;
  const h = hunkOf(f, line);
  if (!h) return line.oldNo;
  const idx = h.lines.indexOf(line);
  for (let i = idx + 1; i < h.lines.length; i++) if (h.lines[i].newNo !== undefined) return h.lines[i].newNo;
  for (let i = idx - 1; i >= 0; i--) if (h.lines[i].newNo !== undefined) return h.lines[i].newNo;
  return Math.max(1, h.newStart);
}
