import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ids, only, scanEdit, scanChange } from './helpers';

const TS = 'export function f(x: number) {\n  return x * 2;\n}\n';
const PY = 'def f(x):\n    return x * 2\n';

describe('suppression-added', () => {
  test('typescript / eslint suppressions', () => {
    for (const [line, sev] of [
      ['// @ts-ignore', 'medium'],
      ['// @ts-expect-error', 'medium'],
      ['// @ts-nocheck', 'high'],
      ['// eslint-disable-next-line', 'medium'],
      ['// eslint-disable-next-line no-explicit-any', 'low'],
      ['/* eslint-disable */', 'high'],
    ]) {
      const f = scanEdit('src/f.ts', TS, `${line}\n${TS}`);
      assert.deepEqual(ids(f), ['suppression-added'], line);
      assert.equal(f[0].severity, sev, line);
    }
  });

  test('python / go / rust / java suppressions', () => {
    assert.deepEqual(ids(scanEdit('pkg/f.py', PY, PY.replace('return x * 2', 'return x * 2  # type: ignore'))), ['suppression-added']);
    assert.deepEqual(ids(scanEdit('pkg/f.py', PY, PY.replace('return x * 2', 'return x * 2  # noqa: E501'))), ['suppression-added']);
    const go = 'package f\n\nfunc F() int {\n\treturn 1\n}\n';
    assert.deepEqual(ids(scanEdit('f/f.go', go, go.replace('func F', '//nolint:errcheck\nfunc F'))), ['suppression-added']);
    const rs = 'pub fn f() -> u8 {\n    1\n}\n';
    assert.deepEqual(ids(scanEdit('src/f.rs', rs, '#[allow(dead_code)]\n' + rs)), ['suppression-added']);
    const crate = scanEdit('src/lib.rs', rs, '#![allow(warnings)]\n' + rs);
    assert.equal(crate[0].severity, 'high');
    const java = 'class F {\n  int f() { return 1; }\n}\n';
    assert.deepEqual(ids(scanEdit('src/main/java/F.java', java, java.replace('  int f', '  @SuppressWarnings("unchecked")\n  int f'))), ['suppression-added']);
  });

  test('blanket vs targeted severity', () => {
    const sevOf = (file: string, a: string, b: string) => scanEdit(file, a, b)[0].severity;
    assert.equal(sevOf('pkg/f.py', PY, PY.replace('return x * 2', 'return x * 2  # type: ignore')), 'medium');
    assert.equal(sevOf('pkg/f.py', PY, PY.replace('return x * 2', 'return x * 2  # type: ignore[attr-defined]')), 'low');
    assert.equal(sevOf('pkg/f.py', PY, PY.replace('return x * 2', 'return x * 2  # noqa')), 'medium');
    assert.equal(sevOf('pkg/f.py', PY, PY.replace('return x * 2', 'return x * 2  # noqa: F401')), 'low');
    const go = 'package f\n\nfunc F() int {\n\treturn 1\n}\n';
    assert.equal(sevOf('f/f.go', go, go.replace('func F', '//nolint\nfunc F')), 'medium');
    assert.equal(sevOf('f/f.go', go, go.replace('func F', '//nolint:errcheck\nfunc F')), 'low');
    const java = 'class F {\n  int f() { return 1; }\n}\n';
    assert.equal(sevOf('src/main/java/F.java', java, java.replace('  int f', '  @SuppressWarnings("all")\n  int f')), 'medium');
    assert.equal(sevOf('src/main/java/F.java', java, java.replace('  int f', '  @SuppressWarnings("unchecked")\n  int f')), 'low');
    assert.equal(sevOf('src/f.ts', TS, '// @ts-ignore\n' + TS), 'medium');
  });

  test('suppression text inside a string is not a suppression', () => {
    const f = scanEdit('src/f.ts', TS, TS + 'export const hint = "add // @ts-ignore to silence";\nexport const py = "# type: ignore";\n');
    assert.deepEqual(ids(f), []);
  });

  test('moved suppression (reordered code) is not new', () => {
    const a = '// @ts-ignore\nimport legacy from "legacy";\nimport a from "a";\n';
    const b = 'import a from "a";\n// @ts-ignore\nimport legacy from "legacy";\n';
    assert.deepEqual(ids(scanEdit('src/i.ts', a, b)), []);
  });

  test('markdown files are not scanned', () => {
    assert.deepEqual(ids(scanChange({ 'README.md': '# x\n' }, { 'README.md': '# x\nUse `// @ts-ignore` and `it.skip`\n' })), []);
  });
});

describe('coverage-exclusion-added', () => {
  test('istanbul ignore / pragma: no cover', () => {
    const f = scanEdit('src/f.ts', TS, TS.replace('  return', '  /* istanbul ignore next */\n  return'));
    assert.deepEqual(ids(f), ['coverage-exclusion-added']);
    assert.equal(f[0].severity, 'low');
    assert.deepEqual(ids(scanEdit('pkg/f.py', PY, PY.replace('def f(x):', 'def f(x):  # pragma: no cover'))), ['coverage-exclusion-added']);
  });
});

describe('ignore-comment-added', () => {
  test('reported (low) and suppresses the rule on the same line', () => {
    const f = scanEdit('src/f.ts', TS, '// @ts-ignore fakegreen-ignore: generated types are wrong upstream\n' + TS);
    assert.deepEqual(ids(f), ['ignore-comment-added']);
    assert.equal(only(f, 'ignore-comment-added')[0].severity, 'low');
  });
});
