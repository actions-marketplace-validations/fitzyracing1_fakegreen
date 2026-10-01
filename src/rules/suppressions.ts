import { findDirective } from '../lang';
import { Draft, isMovedLine, ScanCtx } from '../context';
import { Lang, Severity } from '../types';

type Emit = (d: Draft) => void;

interface Sup {
  re: RegExp;
  label: string;
  severity?: Severity;
  where: 'comment' | 'code';
  langs?: Lang[];
  /** Directive must start the comment (TypeScript / ESLint only honour it there). */
  lead?: boolean;
  /** When this also matches, the suppression names a specific rule/has a justification: downgrade to low. */
  targeted?: RegExp;
}

const SUPPRESSIONS: Sup[] = [
  { re: /@ts-nocheck\b/, label: '@ts-nocheck', lead: true, severity: 'high', where: 'comment', langs: ['js'] },
  { re: /@ts-ignore\b/, label: '@ts-ignore', lead: true, where: 'comment', langs: ['js'] },
  { re: /@ts-expect-error\b/, label: '@ts-expect-error', lead: true, where: 'comment', langs: ['js'], targeted: /@ts-expect-error\s*(?:--|:)?\s*\S+\s+\S+\s+\S+/ },
  { re: /^\s*eslint-disable\s*(?:\*\/)?\s*$/, label: 'eslint-disable (all rules, whole file)', severity: 'high', where: 'comment', langs: ['js'] },
  { re: /\beslint-disable(?:-next-line|-line)?\b/, label: 'eslint-disable', lead: true, where: 'comment', langs: ['js'], targeted: /\beslint-disable-(?:next-)?line\s+[@\w/-]+/ },
  { re: /\b(?:biome-ignore|oxlint-disable\S*|deno-lint-ignore(?:-file)?|tslint:disable\S*|jshint\s+ignore)\b/, label: 'lint suppression', where: 'comment', langs: ['js'] },
  { re: /^\s*mypy:\s*ignore-errors\b/, label: 'mypy: ignore-errors', severity: 'high', where: 'comment', langs: ['py'] },
  { re: /\btype:\s*ignore\b/, label: '# type: ignore', where: 'comment', langs: ['py'], targeted: /\btype:\s*ignore\[[\w-]+/ },
  { re: /\bnoqa\b/i, label: '# noqa', where: 'comment', langs: ['py'], targeted: /\bnoqa\s*:\s*[A-Z]+\d+/i },
  { re: /\b(?:pylint|pyright|pyre)\s*:\s*(?:disable|ignore)|\bpyre-(?:ignore|fixme)\b/, label: 'linter/type-checker suppression', where: 'comment', langs: ['py'], targeted: /(?:disable\s*=\s*[\w-]+|ignore\[[\w-]+|pyre-(?:ignore|fixme)\[\d+)/ },
  { re: /^\s*nolint\b|^\s*lint:ignore\b|#nosec\b/, label: '//nolint', where: 'comment', langs: ['go'], targeted: /^\s*nolint:\s*\w+|^\s*lint:ignore\s+\w+|#nosec\s+G\d+/ },
  { re: /\bNOSONAR\b|\bNOPMD\b|CHECKSTYLE\s*:\s*OFF/i, label: 'static-analysis suppression', where: 'comment', langs: ['java'] },
  { re: /#!\[\s*(?:allow|expect)\s*\(\s*(?:warnings|clippy::all|unused|dead_code)\b/, label: 'crate-wide #![allow(...)]', severity: 'high', where: 'code', langs: ['rust'] },
  { re: /#!?\[\s*(?:allow|expect)\s*\(/, label: '#[allow(...)]', where: 'code', langs: ['rust'], targeted: /#\[\s*(?:allow|expect)\s*\(\s*(?!warnings\b)[\w:]+/ },
  { re: /@SuppressWarnings\b|@Suppress\s*\(/, label: '@SuppressWarnings', where: 'code', langs: ['java'], targeted: /@Suppress(?:Warnings)?\s*\(\s*(?:\{\s*)?"(?!all")/ },
];

const COVERAGE: Sup[] = [
  { re: /\b(?:istanbul|c8|v8)\s+ignore\s+file\b/, label: 'coverage ignore (whole file)', severity: 'medium', where: 'comment', langs: ['js'] },
  { re: /\b(?:istanbul|c8|v8)\s+ignore\b/, label: 'istanbul/c8 ignore', where: 'comment', langs: ['js'] },
  { re: /\bpragma:\s*no\s*(?:cover|branch)\b/, label: 'pragma: no cover', where: 'comment', langs: ['py'] },
  { re: /\bLCOV_EXCL_(?:LINE|START|BR_LINE)\b|\bcoverage:ignore\b/, label: 'coverage exclusion', where: 'comment' },
  { re: /#\[\s*coverage\s*\(\s*off\s*\)\s*\]|#\[\s*cfg_attr\s*\(\s*coverage(?:_nightly)?\s*,\s*coverage\s*\(\s*off/, label: '#[coverage(off)]', where: 'code', langs: ['rust'] },
];

export function suppressions(ctx: ScanCtx, emit: Emit) {
  for (const f of ctx.files) {
    if (f.kind !== 'code') continue;
    for (const l of f.added) {
      if (findDirective(f.flavor === 'none' ? l.text : (l.comment ?? ''))) {
        emit({ ruleId: 'ignore-comment-added', severity: 'low', file: f, line: l, side: 'added', message: 'fakegreen-ignore waiver added; make sure the justification is real', snippet: l.text.trim() });
      }
      if (isMovedLine(ctx, l)) continue;
      const lead = (l.comment ?? '').replace(/^[\s*]+/, '');
      const hit = (list: Sup[]) => list.find((s) => (!s.langs || s.langs.includes(f.lang)) && (s.lead
        ? s.re.test(lead) && lead.search(s.re) === 0
        : s.re.test(s.where === 'comment' ? l.comment : l.code)));
      const sup = hit(SUPPRESSIONS);
      if (sup) {
        const text = sup.where === 'comment' ? l.comment : l.codeStr;
        const targeted = !sup.severity && sup.targeted?.test(text);
        emit({
          ruleId: 'suppression-added', severity: sup.severity ?? (targeted ? 'low' : 'medium'), file: f, line: l, side: 'added',
          message: `Checker silenced with ${sup.label}${targeted ? ' (scoped to a specific rule)' : ''}`, snippet: l.text.trim(),
        });
        continue;
      }
      const cov = hit(COVERAGE);
      if (cov) {
        emit({ ruleId: 'coverage-exclusion-added', severity: cov.severity ?? 'low', file: f, line: l, side: 'added', message: `Code excluded from coverage with ${cov.label}`, snippet: l.text.trim() });
      }
    }
  }
}
