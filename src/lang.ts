import { FileKind, Lang } from './types';

const EXT_LANG: Record<string, Lang> = {
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js', vue: 'js', svelte: 'js',
  py: 'py', pyi: 'py',
  go: 'go',
  rs: 'rust',
  java: 'java', kt: 'java', kts: 'java', scala: 'java', groovy: 'java',
};

export function langOf(path: string): Lang {
  const base = path.split('/').pop() ?? path;
  if (/\.d\.ts$/.test(base)) return 'js';
  const m = /\.([A-Za-z0-9]+)$/.exec(base);
  if (!m) return 'other';
  return EXT_LANG[m[1].toLowerCase()] ?? 'other';
}

/** Paths that are never analysed: vendored code, build output, generated files, docs. */
const SKIP_PATH = [
  /(^|\/)(node_modules|vendor|third_party|bower_components|\.venv|venv|site-packages|dist|build|out|target|coverage|\.next|\.nuxt|__pycache__)\//,
  /\.min\.(js|css)$/,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock|Gemfile\.lock|composer\.lock|uv\.lock)$/,
  /\.(snap|lock|map|svg|png|jpe?g|gif|ico|pdf|woff2?|ttf|eot|zip|gz|tgz)$/i,
  /\.(md|mdx|markdown|rst|txt|adoc|html?|css|scss|less)$/i,
  // Test data and fixtures contain intentionally "bad" code.
  /(^|\/)(testdata|fixtures|__fixtures__|test-fixtures|__snapshots__)\//,
];

const CI_PATH = [
  /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/,
  /(^|\/)\.github\/actions\/.+\.ya?ml$/,
  /(^|\/)action\.ya?ml$/,
  /(^|\/)\.gitlab-ci\.ya?ml$/,
  /(^|\/)\.gitlab\/.+\.ya?ml$/,
  /(^|\/)\.circleci\/config\.ya?ml$/,
  /(^|\/)azure-pipelines\.ya?ml$/,
  /(^|\/)bitbucket-pipelines\.ya?ml$/,
  /(^|\/)\.travis\.ya?ml$/,
  /(^|\/)Jenkinsfile$/,
  /(^|\/)\.buildkite\/.+\.ya?ml$/,
  /(^|\/)\.drone\.ya?ml$/,
  /(^|\/)\.woodpecker(\/.+)?\.ya?ml$/,
  /(^|\/)\.pre-commit-config\.ya?ml$/,
  /(^|\/)\.husky\/[^/]+$/,
  /(^|\/)lefthook\.ya?ml$/,
];

const CONFIG_PATH = [
  /(^|\/)package\.json$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)jsconfig[^/]*\.json$/,
  /(^|\/)(jest|vitest|vite|karma|ava|playwright|cypress|mocha|nyc|c8|babel|webpack|rollup|eslint|stryker)\.config\.[cm]?[jt]s$/,
  /(^|\/)\.(mocharc|nycrc|c8rc|eslintrc|babelrc|jestrc|swcrc)(\.[a-z]+)?$/,
  /(^|\/)eslint\.config\.[cm]?[jt]s$/,
  /(^|\/)(pyproject\.toml|setup\.cfg|tox\.ini|pytest\.ini|\.coveragerc|noxfile\.py|mypy\.ini|\.flake8|ruff\.toml|\.ruff\.toml|conftest\.py)$/,
  /(^|\/)(codecov|\.codecov)\.ya?ml$/,
  /(^|\/)(Cargo\.toml|clippy\.toml|\.cargo\/config(\.toml)?)$/,
  /(^|\/)(go\.mod|\.golangci\.ya?ml|\.golangci\.toml)$/,
  /(^|\/)(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|build\.sbt|gradle\.properties)$/,
  /(^|\/)\.simplecov$/,
  /(^|\/)(turbo|nx|lerna|deno)\.jsonc?$/,
];

const SCRIPT_PATH = [
  /\.(sh|bash|zsh|ps1|bat|cmd)$/,
  /(^|\/)(Makefile|makefile|GNUmakefile|justfile|Justfile|Taskfile\.ya?ml|Rakefile)$/,
  /\.mk$/,
];

export function fileKind(path: string): FileKind {
  if (SKIP_PATH.some((r) => r.test(path))) return 'skip';
  if (CI_PATH.some((r) => r.test(path))) return 'ci';
  if (SCRIPT_PATH.some((r) => r.test(path))) return 'script';
  if (CONFIG_PATH.some((r) => r.test(path))) return langOf(path) === 'other' ? 'config' : 'code';
  if (langOf(path) !== 'other') return 'code';
  return 'skip';
}

/** Config-like code files (jest.config.ts, conftest.py...) are analysed as code AND config. */
export function isConfigFile(path: string): boolean {
  return CONFIG_PATH.some((r) => r.test(path));
}

const TEST_PATH = [
  /(^|\/)(test|tests|__tests__|spec|specs|e2e|integration-tests?|testing)\//,
  /\.(test|spec|e2e|cy)\.[cm]?[jt]sx?$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.py$/,
  /(^|\/)tests?\.py$/,
  /_test\.go$/,
  /(Test|Tests|IT|Spec)\.(java|kt|scala|groovy)$/,
  /(^|\/)src\/(test|androidTest|testFixtures)\//,
  /(^|\/)benches\//,
];

export function isTestPath(path: string, extra: RegExp[] = []): boolean {
  return TEST_PATH.some((r) => r.test(path)) || extra.some((r) => r.test(path));
}

/** Language-independent classification of a path as "test support" (conftest, setup files). */
export function isTestSupportPath(path: string): boolean {
  return /(^|\/)(conftest\.py|setupTests\.[jt]s|jest\.setup\.[jt]s|vitest\.setup\.[jt]s|test[-_]?helpers?\.[a-z]+|testutil[s]?\.[a-z]+)$/.test(path);
}

// ----------------------------------------------------------------------------
// Lexer: splits a line into code / comment, blanking string contents so that
// patterns like ".skip" inside a string literal are never matched.
// ----------------------------------------------------------------------------

export interface LexState {
  /** Inside a block comment (/* ... *\/). */
  block: boolean;
  /** Inside a multi-line string; value is the closing delimiter. */
  str: string | null;
}

export interface LexResult {
  code: string;
  codeStr: string;
  comment: string;
}

export function newLexState(): LexState {
  return { block: false, str: null };
}

export type Flavor = 'c' | 'py' | 'hash' | 'none';

export function flavorOf(path: string, lang: Lang, kind: FileKind): Flavor {
  if (lang === 'py') return 'py';
  if (lang !== 'other') return 'c';
  if (/\.json$/i.test(path)) return 'none';
  if (/\.jsonc$/i.test(path) || /(^|\/)Jenkinsfile$/.test(path) || /\.(gradle|sbt)$/.test(path)) return 'c';
  if (/\.(xml|properties)$/i.test(path)) return 'none';
  if (kind === 'ci' || kind === 'script' || kind === 'config') return 'hash';
  return 'none';
}

export function lexLine(text: string, lang: Lang, flavor: Flavor, st: LexState): LexResult {
  if (flavor === 'none') return { code: text, codeStr: text, comment: '' };
  if (flavor === 'hash') return lexHash(text);
  let code = '';
  let codeStr = '';
  let comment = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (st.block) {
      const end = text.indexOf('*/', i);
      if (end < 0) { comment += text.slice(i); i = n; break; }
      comment += text.slice(i, end);
      i = end + 2;
      st.block = false;
      continue;
    }
    if (st.str) {
      const close = st.str;
      let j = i;
      let closed = false;
      while (j < n) {
        if (text[j] === '\\' && close !== '`raw') { j += 2; continue; }
        if (text.startsWith(close === '`raw' ? '`' : close, j)) { closed = true; break; }
        j++;
      }
      const delim = close === '`raw' ? '`' : close;
      const inner = text.slice(i, Math.min(j, n));
      code += ' '.repeat(inner.length);
      codeStr += inner;
      if (closed) {
        code += delim;
        codeStr += delim;
        i = j + delim.length;
        st.str = null;
      } else {
        i = n;
      }
      continue;
    }
    const c = text[i];
    const rest2 = text.substr(i, 2);
    if (flavor === 'c') {
      if (rest2 === '//') { comment += text.slice(i + 2); break; }
      if (rest2 === '/*') { st.block = true; i += 2; continue; }
      if (c === '"' || c === '`' || (c === "'" && isCharOrStringQuote(text, i, lang))) {
        code += c; codeStr += c;
        st.str = c === '`' && lang === 'go' ? '`raw' : c;
        i++;
        continue;
      }
      if (lang === 'js' && c === '/' && regexAllowed(code)) {
        const end = regexEnd(text, i);
        if (end > 0) {
          // Regex literal: blank its body in `code` so /NODE_ENV === 'test'/ patterns are not matched as code.
          const blank = '/' + ' '.repeat(end - i - 1) + '/';
          code += blank;
          codeStr += blank;
          i = end + 1;
          continue;
        }
      }
      if (lang === 'rust' && c === 'r' && /^r#*"/.test(text.slice(i)) && !/[A-Za-z0-9_]/.test(text[i - 1] ?? '')) {
        const m = /^r(#*)"/.exec(text.slice(i))!;
        code += m[0]; codeStr += m[0];
        st.str = '"' + m[1];
        i += m[0].length;
        continue;
      }
    } else {
      // python
      if (c === '#') { comment += text.slice(i + 1); break; }
      if (c === '"' || c === "'") {
        const triple = text.substr(i, 3) === c.repeat(3);
        const delim = triple ? c.repeat(3) : c;
        code += delim; codeStr += delim;
        st.str = delim;
        i += delim.length;
        continue;
      }
    }
    code += c;
    codeStr += c;
    i++;
  }
  // Single-quoted / double-quoted strings do not span lines (except python triple / JS template / raw).
  if (st.str && (st.str === '"' || st.str === "'") && !text.endsWith('\\')) st.str = null;
  return { code, codeStr, comment };
}

/** A '/' starts a regex literal (not division) after an operator, opening bracket, keyword or at line start. */
function regexAllowed(codeSoFar: string): boolean {
  const t = codeSoFar.trimEnd();
  if (!t) return true;
  if (/[(,=:[!&|?{};+\-*%<>~^]$/.test(t)) return !/(\+\+|--)$/.test(t);
  return /(?:^|[^\w$.])(?:return|typeof|case|do|else|in|of|void|yield|await|delete|throw|new)$/.test(t);
}

/** Index of the closing '/' of a regex literal starting at i, or -1. */
function regexEnd(text: string, i: number): number {
  let inClass = false;
  for (let j = i + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === '\\') { j++; continue; }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) return j === i + 1 ? -1 : j;
  }
  return -1;
}

function isCharOrStringQuote(text: string, i: number, lang: Lang): boolean {
  if (lang === 'js' || lang === 'py') return true;
  // Rust lifetimes ('a), Java/Go/Rust char literals ('x', '\n').
  const rest = text.slice(i);
  if (/^'(\\.|[^\\'])'/.test(rest) || /^'\\u\{?[0-9a-fA-F]+\}?'/.test(rest)) return true;
  return lang === 'java' || lang === 'go' ? /^'[^']*'/.test(rest) : false;
}

/** YAML / shell / TOML / Makefile: '#' starts a comment when at line start or after whitespace. */
function lexHash(text: string): LexResult {
  let inS = false;
  let inD = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS && text[i - 1] !== '\\') inD = !inD;
    else if (c === '#' && !inS && !inD && (i === 0 || /\s/.test(text[i - 1]))) {
      const code = text.slice(0, i);
      return { code, codeStr: code, comment: text.slice(i + 1) };
    }
  }
  return { code: text, codeStr: text, comment: '' };
}

/**
 * Find a `fakegreen-ignore` / `fakegreen-ignore-file` directive in comment text.
 * The directive must start the comment, optionally after other suppression tokens
 * (`// @ts-ignore fakegreen-ignore: why`), so prose that merely mentions it is not a waiver.
 */
export function findDirective(comment: string): { file: boolean; rest: string } | null {
  if (!comment || !comment.includes('fakegreen-ignore')) return null;
  const re = /fakegreen-ignore(-file)?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(comment))) {
    if (comment[m.index - 1] === '`') continue;
    const prefix = comment.slice(0, m.index).replace(/^[\s*\/#!-]+/, '');
    const tokens = prefix.split(/\s+/).filter(Boolean);
    const ok = tokens.length <= 4 && tokens.every((t) => /[@:\-[\]]/.test(t) || /^(?:noqa|nolint|nosonar|pragma|ignore)$/i.test(t));
    if (ok) return { file: !!m[1], rest: comment.slice(m.index + m[0].length) };
  }
  return null;
}
