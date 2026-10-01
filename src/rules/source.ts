import { Draft, FileCtx, isMovedLine, ScanCtx } from '../context';
import { DiffLine, Hunk, Lang, Severity } from '../types';

type Emit = (d: Draft) => void;

interface EnvPat { re: RegExp; label: string; severity: Severity }

// Run against code with comments stripped but string literals kept.
const ENV: Partial<Record<Lang, EnvPat[]>> = {
  js: [
    { re: /process\.env\.NODE_ENV\s*[!=]==?\s*['"`]test['"`]|['"`]test['"`]\s*[!=]==?\s*process\.env\.NODE_ENV/, label: "NODE_ENV === 'test'", severity: 'high' },
    { re: /process\.env(?:\.|\[\s*['"])(?:JEST_WORKER_ID|VITEST|VITEST_WORKER_ID|VITEST_POOL_ID|MOCHA_WORKER_ID|TAP|AVA_PATH|TEST|TESTING|IS_TEST|RUNNING_TESTS|UNIT_TEST|NODE_TEST_CONTEXT)\b/, label: 'test-runner env var', severity: 'high' },
    { re: /import\.meta\.env\.(?:MODE\s*[!=]==?\s*['"`]test['"`]|VITEST\b|TEST\b)/, label: 'import.meta.env test mode', severity: 'high' },
    { re: /typeof\s+(?:jest|describe|it|vi|expect|mocha)\s*[!=]==?\s*['"`]undefined['"`]/, label: 'typeof jest/describe check', severity: 'high' },
    { re: /\bglobalThis\.__(?:TEST|TESTING|JEST)__\b|\b__TEST__\b/, label: '__TEST__ global', severity: 'high' },
    { re: /process\.env(?:\.|\[\s*['"])(?:CI|GITHUB_ACTIONS|GITLAB_CI|CIRCLECI|BUILDKITE|TF_BUILD|JENKINS_URL|TRAVIS)\b|require\(\s*['"](?:is-ci|ci-info)['"]\s*\)|from\s+['"](?:is-ci|ci-info)['"]/, label: 'CI env check', severity: 'medium' },
  ],
  py: [
    { re: /['"](?:pytest|_pytest|unittest)['"]\s+(?:not\s+)?in\s+sys\.modules/, label: '"pytest" in sys.modules', severity: 'high' },
    { re: /PYTEST_CURRENT_TEST|PYTEST_VERSION|PYTEST_XDIST_WORKER/, label: 'PYTEST_* env var', severity: 'high' },
    { re: /sys\.argv[^\n]*['"][^'"]*(?:pytest|unittest|py\.test)[^'"]*['"]|['"](?:pytest|unittest|py\.test)['"][^\n]*sys\.argv/, label: 'sys.argv pytest check', severity: 'high' },
    { re: /os\.(?:environ(?:\.get)?|getenv)\s*[([]\s*['"](?:TESTING|TEST|UNIT_TEST|UNITTEST|RUNNING_TESTS|IS_TEST)['"]/, label: 'TESTING env var', severity: 'high' },
    { re: /\bsettings\.TESTING\b|\bapp\.testing\b|\bcurrent_app\.testing\b/, label: 'settings.TESTING', severity: 'high' },
    { re: /os\.(?:environ(?:\.get)?|getenv)\s*[([]\s*['"](?:CI|GITHUB_ACTIONS|GITLAB_CI|CIRCLECI|BUILDKITE|TF_BUILD|JENKINS_URL)['"]/, label: 'CI env check', severity: 'medium' },
  ],
  go: [
    { re: /\btesting\.Testing\s*\(\s*\)/, label: 'testing.Testing()', severity: 'high' },
    { re: /flag\.Lookup\s*\(\s*"test\.\w+"\s*\)/, label: 'flag.Lookup("test.v")', severity: 'high' },
    { re: /os\.Args\[0\][^\n]*"\.test"|"\.test"[^\n]*os\.Args\[0\]/, label: 'os.Args[0] ends with .test', severity: 'high' },
    { re: /os\.(?:Getenv|LookupEnv)\s*\(\s*"(?:TEST|TESTING|GO_TEST|UNIT_TEST)\w*"\s*\)/, label: 'TEST env var', severity: 'high' },
    { re: /os\.(?:Getenv|LookupEnv)\s*\(\s*"(?:CI|GITHUB_ACTIONS|GITLAB_CI|CIRCLECI|BUILDKITE)"\s*\)/, label: 'CI env check', severity: 'medium' },
  ],
  rust: [
    { re: /\bcfg!\s*\(\s*test\s*\)/, label: 'cfg!(test)', severity: 'high' },
    { re: /env::var(?:_os)?\s*\(\s*"(?:TEST|TESTING|RUST_TEST\w*|NEXTEST\w*)"\s*\)/, label: 'test env var', severity: 'high' },
    { re: /env::var(?:_os)?\s*\(\s*"(?:CI|GITHUB_ACTIONS|GITLAB_CI)"\s*\)/, label: 'CI env check', severity: 'medium' },
  ],
  java: [
    { re: /Class\.forName\s*\(\s*"org\.junit[\w.]*"\s*\)|"org\.junit\.[\w.]*"\s*\)?\s*!=\s*null/, label: 'JUnit-on-classpath check', severity: 'high' },
    { re: /System\.(?:getProperty|getenv)\s*\(\s*"(?:test|testing|TEST|TESTING|junit\.\w+)"\s*\)/, label: 'test system property', severity: 'high' },
    { re: /System\.getenv\s*\(\s*"(?:CI|GITHUB_ACTIONS|GITLAB_CI|JENKINS_URL)"\s*\)/, label: 'CI env check', severity: 'medium' },
  ],
};

const TOOLING_PATH = /(^|\/)(scripts?|tools?|tooling|build|\.github|config|configs|bin|ci|e2e|playwright|cypress|benchmarks?|examples?|docs?)\/|\.config\.[cm]?[jt]s$|(^|\/)(setup\.py|noxfile\.py|fabfile\.py|gulpfile\.[jt]s|Gruntfile\.[jt]s|build\.rs)$/;

function demote(s: Severity): Severity {
  return s === 'high' ? 'medium' : 'low';
}

export function testEnvSpecialCase(ctx: ScanCtx, emit: Emit) {
  for (const f of ctx.files) {
    if (f.kind !== 'code' || f.isTest || f.isTestSupport) continue;
    const pats = ENV[f.lang];
    if (!pats) continue;
    const tooling = f.isConfig || TOOLING_PATH.test(f.path);
    for (const l of f.added) {
      if (isMovedLine(ctx, l)) continue;
      const p = pats.find((x) => {
        // Match with string literals kept (to compare 'test'), but the match must not start inside a string.
        const m = new RegExp(x.re.source, x.re.flags.replace('g', '')).exec(l.codeStr);
        return !!m && l.code[m.index] === l.codeStr[m.index];
      });
      if (!p) continue;
      let severity = p.severity;
      let message = p.severity === 'high'
        ? `Non-test code branches on the test env (${p.label}); tests skip the real path`
        : `Source code special-cases CI (${p.label}); behaviour in CI may differ from production`;
      if (tooling) { severity = demote(severity); message += ' (tooling/config file)'; }
      emit({ ruleId: 'test-env-special-case', severity, file: f, line: l, side: 'added', message, snippet: l.text.trim() });
    }
  }
}

// ----------------------------------------------------------------------------

function isBlank(l: DiffLine) {
  return l.code.trim() === '';
}

export function errorSwallowed(ctx: ScanCtx, emit: Emit) {
  for (const f of ctx.files) {
    if (f.kind !== 'code' || f.lang === 'other') continue;
    for (const h of f.diff.hunks) scanHunk(ctx, f, h, emit);
  }
}

const C_CATCH_OPEN = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*$/;
const C_CATCH_EMPTY = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/;
const PROMISE_CATCH = /\.catch\s*\(\s*(?:(?:async\s*)?(?:\(\s*[\w$]*\s*\)|[\w$]+)\s*=>\s*(?:\{\s*\}|undefined|null|void\s+0|\(\s*\)\s*=>\s*\{\s*\})|(?:async\s+)?function\s*\w*\s*\([^)]*\)\s*\{\s*\}|noop|_\.noop|\(\)\s*=>\s*\{\s*\})\s*\)/;
const GO_ERR_OPEN = /\bif\s+(?:[\w, ]+:?=\s*[^;]+;\s*)?err\s*!=\s*nil\s*\{\s*$/;
const GO_ERR_EMPTY = /\bif\s+(?:[\w, ]+:?=\s*[^;]+;\s*)?err\s*!=\s*nil\s*\{\s*\}/;
const RUST_ERR_EMPTY = /\bErr\s*\(\s*_\w*\s*\)\s*=>\s*(?:\{\s*\}|\(\s*\))/;
const PY_EXCEPT = /^(\s*)except\s*(?:\(?\s*(?:Base)?Exception\b[^:]*)?:\s*(pass|\.\.\.)?\s*$/;
const PY_SUPPRESS = /\bsuppress\s*\(\s*(?:Base)?Exception\s*\)/;

function scanHunk(ctx: ScanCtx, f: FileCtx, h: Hunk, emit: Emit) {
  const lines = h.lines;
  const report = (anchor: DiffLine, involved: DiffLine[], what: string, withComment: boolean) => {
    const touched = involved.some((l) => l.kind !== ' ');
    if (!touched) return;
    const addedLines = involved.filter((l) => l.kind === '+');
    if (addedLines.length && addedLines.every((l) => isMovedLine(ctx, l))) return;
    const severity: Severity = withComment ? 'low' : 'medium';
    emit({
      ruleId: 'error-swallowed', severity, file: f, line: anchor, side: 'added',
      message: `${what}${withComment ? ' (with a comment)' : ''}; failures will pass silently`,
      snippet: involved.filter((l) => l.kind !== '-').map((l) => l.text.trim()).join(' ').slice(0, 160),
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.kind === '-') continue;
    const code = l.code;
    if (f.lang === 'js' || f.lang === 'java') {
      if (C_CATCH_EMPTY.test(code)) { report(l, [l], 'Empty catch block', /\S/.test(l.comment)); continue; }
      if (f.lang === 'js' && PROMISE_CATCH.test(code)) { report(l, [l], 'Promise rejection swallowed with .catch(() => {})', false); continue; }
      if (C_CATCH_OPEN.test(code)) {
        const body = collectUntil(lines, i, (x) => /^\s*\}/.test(x.code));
        if (body) report(l, body.involved, 'Empty catch block', body.hasComment);
      }
    } else if (f.lang === 'go') {
      if (GO_ERR_EMPTY.test(code)) { report(l, [l], 'Error ignored with empty `if err != nil {}`', false); continue; }
      if (GO_ERR_OPEN.test(code)) {
        const body = collectUntil(lines, i, (x) => /^\s*\}/.test(x.code));
        if (body) report(l, body.involved, 'Error ignored with empty `if err != nil {}`', body.hasComment);
      }
    } else if (f.lang === 'rust') {
      if (RUST_ERR_EMPTY.test(code)) report(l, [l], 'Error ignored with `Err(_) => {}`', false);
    } else if (f.lang === 'py') {
      if (PY_SUPPRESS.test(code)) { report(l, [l], 'Exceptions suppressed with contextlib.suppress(Exception)', false); continue; }
      const m = PY_EXCEPT.exec(code);
      if (!m) continue;
      const what = /except\s*:/.test(code) ? 'Bare `except: pass`' : '`except Exception: pass`';
      if (m[2]) { report(l, [l], what, /\S/.test(l.comment)); continue; }
      // body on following lines: exactly one statement that is `pass` / `...`
      const indent = m[1].length;
      const involved: DiffLine[] = [l];
      let j = i + 1;
      let hasComment = false;
      let bodyLine: DiffLine | undefined;
      for (; j < lines.length; j++) {
        const x = lines[j];
        involved.push(x);
        if (x.kind === '-') continue;
        if (isBlank(x)) { if (x.comment.trim()) hasComment = true; continue; }
        bodyLine = x;
        break;
      }
      if (!bodyLine || !/^\s*(pass|\.\.\.)\s*$/.test(bodyLine.code)) continue;
      // make sure nothing else follows in the same block
      for (let k = j + 1; k < lines.length; k++) {
        const x = lines[k];
        if (x.kind === '-' || isBlank(x)) continue;
        const ind = /^\s*/.exec(x.text)![0].length;
        if (ind > indent) { bodyLine = undefined; }
        break;
      }
      if (bodyLine) report(l, involved, what, hasComment || /\S/.test(bodyLine.comment));
    }
  }
}

/** From an opening line, walk forward over blank/comment-only lines until a closer; return involved lines. */
function collectUntil(lines: DiffLine[], start: number, isClose: (l: DiffLine) => boolean) {
  const involved: DiffLine[] = [lines[start]];
  let hasComment = false;
  for (let j = start + 1; j < lines.length; j++) {
    const x = lines[j];
    involved.push(x);
    if (x.kind === '-') {
      if (x.code.trim()) continue; // removed body lines -> still counts as emptied
      continue;
    }
    if (isBlank(x)) { if (x.comment.trim()) hasComment = true; continue; }
    if (isClose(x)) return { involved, hasComment };
    return null;
  }
  return null;
}
