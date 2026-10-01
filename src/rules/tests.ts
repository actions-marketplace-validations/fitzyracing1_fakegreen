import { anchorFor, Draft, FileCtx, isMovedLine, norm, ScanCtx } from '../context';
import { DiffLine } from '../types';
import { COND_SKIP, countMatches, FOCUS, INLINE_TEST_LANGS, Pat, SKIP, TEST_DECL } from './patterns';

type Emit = (d: Draft) => void;

/** Strip test-ish affixes to find the "subject" a test file covers: src/foo.test.ts -> foo. */
export function testStem(path: string): string {
  const base = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '');
  return base
    .replace(/\.(test|spec|e2e|cy)$/i, '')
    .replace(/^test_/, '')
    .replace(/_test$/, '')
    .replace(/(Tests?|IT|Spec)$/, '')
    .toLowerCase();
}

export function isDecl(f: FileCtx, l: DiffLine): boolean {
  return countMatches(l.code, TEST_DECL[f.lang]) > 0;
}

function countsTests(f: FileCtx): boolean {
  if (!TEST_DECL[f.lang]) return false;
  if (f.isTest) return true;
  // Rust/Java tests can live in regular source files, but tests deleted together with
  // their (deleted) source file are not counted.
  return INLINE_TEST_LANGS.includes(f.lang) && f.diff.status !== 'deleted';
}

export interface DeclStats {
  removed: DiffLine[];
  added: DiffLine[];
  movedOut: number;
  /** Net tests lost in this file after discounting tests moved verbatim to other files. */
  lost: number;
}

const statsCache = new WeakMap<ScanCtx, Map<FileCtx, DeclStats>>();

export function declStats(ctx: ScanCtx): Map<FileCtx, DeclStats> {
  const hit = statsCache.get(ctx);
  if (hit) return hit;
  const m = new Map<FileCtx, DeclStats>();
  for (const f of ctx.files) {
    if (!countsTests(f)) continue;
    const removed = f.removed.filter((l) => isDecl(f, l));
    const added = f.added.filter((l) => isDecl(f, l));
    if (!removed.length && !added.length) continue;
    const addedHere = new Set(added.map((l) => norm(l.text)));
    const movedOut = removed.filter((l) => !addedHere.has(norm(l.text)) && isMovedLine(ctx, l)).length;
    const lost = Math.max(0, removed.length - added.length - movedOut);
    m.set(f, { removed, added, movedOut, lost });
  }
  statsCache.set(ctx, m);
  return m;
}

/** Deleted test files that are really moves (most of their lines re-appear as added lines). */
function movedFraction(ctx: ScanCtx, f: FileCtx): number {
  const sig = f.removed.filter((l) => norm(l.text).length >= 8);
  if (!sig.length) return 0;
  return sig.filter((l) => isMovedLine(ctx, l)).length / sig.length;
}

export function testFileDeleted(ctx: ScanCtx, emit: Emit): Set<FileCtx> {
  const reported = new Set<FileCtx>();
  for (const f of ctx.files) {
    if (f.diff.status !== 'deleted' || !f.isTest) continue;
    const frac = movedFraction(ctx, f);
    if (frac >= 0.6) continue; // moved/split into other files
    const decls = f.removed.filter((l) => isDecl(f, l));
    const stem = testStem(f.path);
    const sourceDeleted = ctx.files.some((g) => g !== f && g.diff.status === 'deleted' && !g.isTest && testStem(g.path) === stem);
    let severity: Draft['severity'] = 'high';
    let message = `Test file deleted (${decls.length} test case${decls.length === 1 ? '' : 's'} removed)`;
    if (decls.length === 0) { severity = 'low'; message = 'File in a test directory deleted (no test cases detected)'; }
    if (sourceDeleted && decls.length) { severity = 'medium'; message += ' together with its source file; confirm the feature was really removed'; }
    if (frac >= 0.3) { severity = 'medium'; message += `; ${Math.round(frac * 100)}% of its lines reappear elsewhere (partial move?)`; }
    reported.add(f);
    emit({ ruleId: 'test-file-deleted', severity, file: f, side: 'file', message, snippet: decls[0]?.text.trim() });
  }
  return reported;
}

export function testCountDropped(ctx: ScanCtx, emit: Emit) {
  const stats = declStats(ctx);
  let globalNet = 0;
  for (const [f, s] of stats) {
    const stem = testStem(f.path);
    const withSource = f.diff.status === 'deleted' && ctx.files.some((g) => g !== f && g.diff.status === 'deleted' && !g.isTest && testStem(g.path) === stem);
    if (withSource) continue;
    globalNet += s.added.length - s.removed.length;
  }
  for (const [f, s] of stats) {
    if (f.diff.status === 'deleted' || s.lost <= 0) continue;
    const firstUnmoved = s.removed.find((l) => !isMovedLine(ctx, l)) ?? s.removed[0];
    const commented = s.removed.filter((r) => f.added.some((a) => a.comment && a.comment.includes(norm(r.text).slice(0, 40)))).length;
    let message = `Net test cases dropped by ${s.lost} (${s.removed.length} removed, ${s.added.length} added)`;
    if (commented) message += `; ${commented} commented out`;
    let severity: Draft['severity'] = 'high';
    if (globalNet >= 0) {
      severity = 'medium';
      message += '; other tests were added elsewhere in the diff, verify they cover the same behaviour';
    }
    emit({ ruleId: 'test-count-dropped', severity, file: f, line: firstUnmoved, side: 'removed', message, snippet: firstUnmoved.text.trim() });
  }
}

function matchPats(code: string, pats: Pat[] | undefined): Pat | undefined {
  return pats?.find((p) => p.re.test(code));
}

/** Previous non-blank new-side line before `l` within its hunk. */
function prevNewSide(f: FileCtx, l: DiffLine): DiffLine | undefined {
  for (const h of f.diff.hunks) {
    const idx = h.lines.indexOf(l);
    if (idx < 0) continue;
    for (let i = idx - 1; i >= 0; i--) {
      const p = h.lines[i];
      if (p.kind === '-') continue;
      if (p.code.trim()) return p;
    }
  }
  return undefined;
}

export function skipsAndFocus(ctx: ScanCtx, emit: Emit) {
  for (const f of ctx.files) {
    if (f.kind !== 'code') continue;
    // Go skips only matter in _test.go files; JS/Python patterns are specific enough anywhere.
    if (f.lang === 'go' && !f.isTest) continue;
    for (const l of f.added) {
      if (isMovedLine(ctx, l)) continue;
      // node:test / tap options object: test('x', { skip: ... }, fn), { only: true }
      if (f.lang === 'js' && isDecl(f, l)) {
        const opt = /[{,]\s*(skip|todo|only)\s*:\s*([^,}]+)/.exec(l.codeStr);
        if (opt && !/^\s*(?:false|undefined|null|0)\s*$/.test(opt[2])) {
          const literal = /^\s*(?:true|1|'[^']*'|"[^"]*"|`[^`]*`)\s*$/.test(opt[2]);
          if (opt[1] === 'only') {
            emit({ ruleId: 'test-focused', severity: 'high', file: f, line: l, side: 'added', message: 'Focused test ({ only: ... }) silently disables the rest of the suite', snippet: l.text.trim() });
          } else if (literal) {
            emit({ ruleId: 'test-skipped', severity: 'high', file: f, line: l, side: 'added', message: `Test skipped with { ${opt[1]}: ${opt[2].trim()} }`, snippet: l.text.trim() });
          } else {
            emit({ ruleId: 'test-conditional-skip', severity: 'low', file: f, line: l, side: 'added', message: `Conditional skip added ({ ${opt[1]}: ${opt[2].trim()} })`, snippet: l.text.trim() });
          }
          continue;
        }
      }
      const focus = matchPats(l.code, FOCUS[f.lang]);
      if (focus) {
        emit({ ruleId: 'test-focused', severity: 'high', file: f, line: l, side: 'added', message: `Focused test (${focus.label}) silently disables the rest of the suite`, snippet: l.text.trim() });
        continue;
      }
      const skip = matchPats(l.code, SKIP[f.lang]);
      if (skip) {
        // `if testing.Short() { t.Skip() }`, `if (!x) this.skip()`, `if sys.platform == ...: pytest.skip()`
        // are conditional skips. Decorators/modifiers (it.skip, @pytest.mark.skip) never are.
        const prev = prevNewSide(f, l);
        const callForm = /\b(?:[tb]\.Skip|this\.skip|t\.skip|pytest\.(?:skip|xfail)|self\.skipTest|SkipTest)\b/.test(l.code);
        const guarded = callForm && (/^\s*(?:\}\s*else\s+)?if\b/.test(l.code) || (!!prev && /^\s*(?:\}\s*else\s+)?(?:if|elif|else)\b.*(?:\{|:)\s*$|^\s*(?:\}\s*)?else\s*(?:\{|:)\s*$/.test(prev.code)));
        if (guarded) {
          emit({ ruleId: 'test-conditional-skip', severity: 'low', file: f, line: l, side: 'added', message: `Conditional skip added (${skip.label} inside if)`, snippet: l.text.trim() });
        } else {
          emit({ ruleId: 'test-skipped', severity: 'high', file: f, line: l, side: 'added', message: `Test skipped with ${skip.label}`, snippet: l.text.trim() });
        }
        continue;
      }
      const cond = matchPats(l.code, COND_SKIP[f.lang]);
      if (cond) {
        // skipif(True) / skipIf(true) is an unconditional skip in disguise.
        if (/\b(?:skip[Ii]f|skipif|runIf)\s*\(\s*(?:True|true|1|!0|!\s*false)\s*[,)]|\brunIf\s*\(\s*(?:False|false|0)\s*[,)]/.test(l.codeStr)) {
          emit({ ruleId: 'test-skipped', severity: 'high', file: f, line: l, side: 'added', message: `Test skipped with an always-true condition (${cond.label})`, snippet: l.text.trim() });
          continue;
        }
        emit({ ruleId: 'test-conditional-skip', severity: 'low', file: f, line: l, side: 'added', message: `Conditional skip added (${cond.label})`, snippet: l.text.trim() });
      }
    }
  }
}

export { anchorFor };
