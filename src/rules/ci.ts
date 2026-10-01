import { Draft, FileCtx, isMovedLine, norm, ScanCtx } from '../context';
import { DiffLine, Hunk } from '../types';
import { CHECK_CMD } from './patterns';

type Emit = (d: Draft) => void;

function isCiish(f: FileCtx): boolean {
  return f.kind === 'ci' || f.kind === 'script' || f.kind === 'config' || f.isConfig;
}

const IGNORE_FAILURE: { re: RegExp; label: string; severity: Draft['severity']; ciOnly?: boolean; needsCmd?: boolean }[] = [
  { re: /\|\|\s*(?:true|:|exit\s+0|echo\b[^|&;]*)\s*(?:$|["'`;)&|])/, label: '`|| true`', severity: 'high', needsCmd: true },
  { re: /\bcontinue-on-error\s*:\s*(?:true|['"]true['"]|\$\{\{\s*true\s*\}\})/, label: 'continue-on-error: true', severity: 'high', ciOnly: true },
  { re: /\b(?:allow_failure|soft_fail|allowFailure|ignore_failure)\s*:\s*true\b/, label: 'allow_failure: true', severity: 'high', ciOnly: true },
  { re: /--exit-zero\b/, label: '--exit-zero', severity: 'high' },
  { re: /-DtestFailureIgnore=true|<testFailureIgnore>\s*true|\bignoreFailures\s*=\s*true\b/, label: 'test failures ignored', severity: 'high' },
  { re: /^\s*set\s+\+e\b/, label: 'set +e', severity: 'medium' },
  { re: /\bgit\s+(?:commit|push)\b[^\n]*--no-verify\b|\bHUSKY=0\b|\bSKIP=\S+\s+git\b/, label: '--no-verify (hooks bypassed)', severity: 'medium' },
];

const EXCLUSIONS: { re: RegExp; label: string; severity: Draft['severity'] }[] = [
  { re: /-DskipTests\b|-Dmaven\.test\.skip=true|--skip-tests?\b|\s-x\s+:?test\b|--exclude-task\s+:?test\b|\bSKIP_TESTS\s*=\s*['"]?(?:1|true)/, label: 'tests skipped by build flag', severity: 'high' },
  { re: /--passWithNoTests\b|--pass-with-no-tests\b|passWithNoTests['"]?\s*:\s*true/, label: '--passWithNoTests', severity: 'medium' },
  { re: /\b(?:testPathIgnorePatterns|modulePathIgnorePatterns)\b/, label: 'testPathIgnorePatterns', severity: 'medium' },
  { re: /--ignore(?:-glob)?[= ]\S*test|--deselect\b|\bcollect_ignore(?:_glob)?\b|\bnorecursedirs\s*=.*\btests?\b|(?:^|\s)-k\s+['"]?not\s/, label: 'tests deselected', severity: 'medium' },
];

export function ciRules(ctx: ScanCtx, emit: Emit) {
  for (const f of ctx.files) {
    if (!isCiish(f)) continue;
    const isPkg = /(^|\/)package\.json$/.test(f.path);
    for (const l of f.added) {
      if (isMovedLine(ctx, l)) continue;
      const code = l.codeStr;
      // ---- ignored failures
      for (const p of IGNORE_FAILURE) {
        if (p.ciOnly && f.kind !== 'ci') continue;
        if (!p.re.test(code)) continue;
        let severity = p.severity;
        let message = `Failure ignored with ${p.label}`;
        if (p.needsCmd) {
          if (CHECK_CMD.test(code)) message += ' on a test/check command';
          else { severity = 'low'; message += ' (not on a recognised test/check command)'; }
        }
        emit({ ruleId: 'ci-failure-ignored', severity, file: f, line: l, side: 'added', message, snippet: l.text.trim() });
        break;
      }
      // ---- disabled steps
      if (f.kind === 'ci') {
        if (/^\s*-?\s*if\s*:\s*(?:false|['"]false['"]|\$\{\{\s*false\s*\}\}|0)\s*$/.test(code)) {
          emit({ ruleId: 'ci-step-disabled', severity: 'high', file: f, line: l, side: 'added', message: 'CI job/step disabled with `if: false`', snippet: l.text.trim() });
        } else if (/^\s*-?\s*when\s*:\s*never\s*$/.test(code)) {
          emit({ ruleId: 'ci-step-disabled', severity: 'medium', file: f, line: l, side: 'added', message: 'CI job disabled with `when: never`', snippet: l.text.trim() });
        }
      }
      // ---- exclusions
      for (const p of EXCLUSIONS) {
        if (!p.re.test(code)) continue;
        if (p.label === 'testPathIgnorePatterns' && /node_modules/.test(code) && !/test|spec|__tests__/i.test(code.replace(/testPathIgnorePatterns|modulePathIgnorePatterns/, ''))) break;
        emit({ ruleId: 'test-exclusion-added', severity: p.severity, file: f, line: l, side: 'added', message: `Tests excluded from the run (${p.label})`, snippet: l.text.trim() });
        break;
      }
      // ---- neutered npm test script
      if (isPkg) {
        const m = /"test"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(l.text);
        if (m) {
          const v = m[1].replace(/\\"/g, '"').trim();
          if (/^(true|exit 0|:|)$/.test(v) || (/^echo\b/.test(v) && !/exit\s+1/.test(v)) || /&&\s*exit\s+0\s*$|\|\|\s*exit\s+0\s*$/.test(v)) {
            emit({ ruleId: 'test-script-neutered', severity: 'high', file: f, line: l, side: 'added', message: `npm test script no longer runs tests ("${v || '(empty)'}")`, snippet: l.text.trim() });
          }
        }
      }
    }
  }
  removedSteps(ctx, emit);
  coverageThresholds(ctx, emit);
  typecheckAndLint(ctx, emit);
}

// ----------------------------------------------------------------------------

function cmdKey(code: string): string | null {
  const m = CHECK_CMD.exec(code);
  return m ? norm(m[0]).toLowerCase() : null;
}

function removedSteps(ctx: ScanCtx, emit: Emit) {
  const addedKeys = new Set<string>();
  for (const f of ctx.files) {
    if (!isStepFile(f)) continue;
    for (const l of f.added) { const k = cmdKey(l.codeStr); if (k) addedKeys.add(k); }
  }
  for (const f of ctx.files) {
    if (!isStepFile(f)) continue;
    const lost: DiffLine[] = [];
    let replacement: DiffLine | undefined;
    for (const h of f.diff.hunks) {
      const removedCmds = h.lines.filter((l) => l.kind === '-' && cmdKey(l.codeStr) && !isMovedLine(ctx, l));
      if (!removedCmds.length) continue;
      // A hunk that introduces a *new* check command (jest -> vitest) is a migration, not a removal.
      const removedKeys = new Set(removedCmds.map((l) => cmdKey(l.codeStr)!));
      if (h.lines.some((l) => l.kind === '+' && cmdKey(l.codeStr) && !removedKeys.has(cmdKey(l.codeStr)!))) continue;
      const before = lost.length;
      for (const l of removedCmds) if (!addedKeys.has(cmdKey(l.codeStr)!)) lost.push(l);
      // Replaced by a command we don't recognise (new task runner, wrapper script)? Still worth a look, but medium.
      if (lost.length > before && !replacement) {
        const shellish = f.kind === 'script' || /(^|\/)\.husky\//.test(f.path);
        replacement = h.lines.find((l) => l.kind === '+' && !isMovedLine(ctx, l) &&
          (shellish ? /[A-Za-z]/.test(l.code) : /^\s*(?:-\s*)?(?:run|script|command|commands|entry)\s*:|^\s*"[\w:-]+"\s*:\s*"/.test(l.codeStr)) &&
          // "replaced" by a no-op is still a removal
          !/(?:^|[\s:"'])(?:echo|true|exit\s+0|:)(?:\s|["']|$)/.test(l.codeStr.replace(/^\s*(?:-\s*)?(?:run|script|command|commands|entry)\s*:/, ' ')));
      }
    }
    if (!lost.length) continue;
    const cmds = [...new Set(lost.map((l) => cmdKey(l.codeStr)!))];
    const deleted = f.diff.status === 'deleted';
    let message = `${deleted ? 'File deleted that ran' : 'Removed'} check command${cmds.length > 1 ? 's' : ''}: ${cmds.slice(0, 4).join(', ')}${cmds.length > 4 ? ', …' : ''}`;
    if (replacement) message += `; replaced by \`${replacement.text.trim().slice(0, 60)}\`, verify it still runs the checks`;
    emit({
      ruleId: 'ci-step-removed', severity: replacement ? 'medium' : 'high', file: f, line: deleted ? undefined : lost[0], side: deleted ? 'file' : 'removed',
      message,
      snippet: lost[0].text.trim(),
    });
  }
}

function isStepFile(f: FileCtx): boolean {
  return f.kind === 'ci' || f.kind === 'script' || /(^|\/)(package\.json|tox\.ini|noxfile\.py|pyproject\.toml|setup\.cfg|turbo\.json|lefthook\.ya?ml)$/.test(f.path);
}

// ----------------------------------------------------------------------------

const THRESH = /(--cov-fail-under|fail_under|fail-under|failUnder|minimum_coverage|minimumCoverage|min_coverage|minCoverage|covered_?ratio|check-coverage|branches|functions|lines|statements|threshold|target|minimum|perFile)["']?\s*(?:[:=>]|\s)\s*["']?(\d+(?:\.\d+)?)%?/gi;
const AMBIGUOUS = /^(branches|functions|lines|statements|threshold|target|minimum|perfile)$/i;
const COVERAGE_FILE = /(^|\/)(\.nycrc(\.\w+)?|\.c8rc(\.\w+)?|\.?codecov\.ya?ml|\.coveragerc|\.simplecov)$/;
const COVERAGE_WORDS = /cover|threshold|jacoco|nyc|\bc8\b|istanbul|codecov|simplecov/i;

interface Thr { key: string; value: number; line: DiffLine }

function thresholds(l: DiffLine, coverageContext: boolean): Thr[] {
  const out: Thr[] = [];
  const re = new RegExp(THRESH.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(l.codeStr))) {
    const key = m[1].toLowerCase().replace(/[-_]/g, '');
    if (AMBIGUOUS.test(m[1]) && !coverageContext) continue;
    if (key === 'checkcoverage' && /true|false/.test(m[0])) continue;
    out.push({ key, value: parseFloat(m[2]), line: l });
  }
  return out;
}

function hunkMentionsCoverage(h: Hunk): boolean {
  return COVERAGE_WORDS.test(h.header) || h.lines.some((l) => COVERAGE_WORDS.test(l.text));
}

function coverageThresholds(ctx: ScanCtx, emit: Emit) {
  for (const f of ctx.files) {
    if (!isCiish(f) && !COVERAGE_FILE.test(f.path)) continue;
    const covFile = COVERAGE_FILE.test(f.path);
    const removed: Thr[] = [];
    const added: Thr[] = [];
    for (const h of f.diff.hunks) {
      const cc = covFile || hunkMentionsCoverage(h);
      for (const l of h.lines) {
        if (l.kind === '-') removed.push(...thresholds(l, cc));
        if (l.kind === '+') added.push(...thresholds(l, cc));
      }
    }
    const usedAdded = new Set<Thr>();
    for (const r of removed) {
      const a = added.find((x) => !usedAdded.has(x) && x.key === r.key);
      if (a) {
        usedAdded.add(a);
        if (a.value < r.value) {
          emit({ ruleId: 'coverage-threshold-lowered', severity: 'high', file: f, line: a.line, side: 'added', message: `Coverage threshold lowered: ${r.key} ${r.value} → ${a.value}`, snippet: `- ${r.line.text.trim()}\n+ ${a.line.text.trim()}` });
        }
      } else if (r.value > 0 && f.diff.status !== 'deleted') {
        emit({ ruleId: 'coverage-threshold-lowered', severity: 'medium', file: f, line: r.line, side: 'removed', message: `Coverage threshold removed (${r.key}: ${r.value})`, snippet: r.line.text.trim() });
      }
    }
  }
}

// ----------------------------------------------------------------------------

const TS_FLAGS = /"(strict|noImplicitAny|strictNullChecks|strictFunctionTypes|strictBindCallApply|strictPropertyInitialization|noImplicitReturns|noImplicitThis|alwaysStrict|noUncheckedIndexedAccess|exactOptionalPropertyTypes|useUnknownInCatchVariables|noEmitOnError|checkJs|noFallthroughCasesInSwitch)"\s*:\s*false\b/;
const PY_TYPE = /^\s*(ignore_errors\s*=\s*true|(?:strict|disallow_untyped_defs|disallow_any_generics|check_untyped_defs|warn_return_any|strict_optional|disallow_incomplete_defs)\s*=\s*false)\b|typeCheckingMode["']?\s*[:=]\s*["'](?:off|basic)["']/i;

function typecheckAndLint(ctx: ScanCtx, emit: Emit) {
  for (const f of ctx.files) {
    const isTsconfig = /(^|\/)[tj]sconfig[^/]*\.json$/.test(f.path);
    const isPyCfg = /(^|\/)(pyproject\.toml|mypy\.ini|\.mypy\.ini|setup\.cfg|pyrightconfig\.json)$/.test(f.path);
    const isEslint = /(^|\/)(\.eslintrc(\.\w+)?|eslint\.config\.[cm]?[jt]s)$/.test(f.path) || /(^|\/)package\.json$/.test(f.path);
    const isRuff = /(^|\/)(pyproject\.toml|ruff\.toml|\.ruff\.toml|\.flake8|setup\.cfg|tox\.ini)$/.test(f.path);
    if (!isTsconfig && !isPyCfg && !isEslint && !isRuff) continue;
    for (const l of f.added) {
      if (isMovedLine(ctx, l)) continue;
      const t = l.codeStr;
      if (isTsconfig && TS_FLAGS.test(t)) {
        emit({ ruleId: 'typecheck-weakened', severity: 'medium', file: f, line: l, side: 'added', message: `TypeScript check disabled (${TS_FLAGS.exec(t)![1]}: false)`, snippet: l.text.trim() });
      } else if (isPyCfg && PY_TYPE.test(t)) {
        emit({ ruleId: 'typecheck-weakened', severity: 'medium', file: f, line: l, side: 'added', message: 'Python type checking relaxed', snippet: l.text.trim() });
      } else if (isEslint && /(?:^|[\s{,])['"]?[@\w/-]+['"]?\s*:\s*(?:\[\s*)?(?:['"]off['"]|0)\s*(?:[,\]}]|$)/.test(t) && !/version|port|timeout|max/i.test(t)) {
        emit({ ruleId: 'lint-rule-disabled', severity: 'low', file: f, line: l, side: 'added', message: 'Lint rule turned off', snippet: l.text.trim() });
      } else if (isRuff && /^\s*(?:extend-)?(?:ignore|per-file-ignores)\s*=/.test(t)) {
        emit({ ruleId: 'lint-rule-disabled', severity: 'low', file: f, line: l, side: 'added', message: 'Lint rules ignored', snippet: l.text.trim() });
      }
    }
    if (isTsconfig) {
      const removedStrict = f.removed.find((l) => /"strict"\s*:\s*true/.test(l.codeStr));
      if (removedStrict && !f.added.some((l) => /"strict"\s*:/.test(l.codeStr)) && f.diff.status !== 'deleted') {
        emit({ ruleId: 'typecheck-weakened', severity: 'medium', file: f, line: removedStrict, side: 'removed', message: 'TypeScript "strict": true removed', snippet: removedStrict.text.trim() });
      }
    }
  }
}
