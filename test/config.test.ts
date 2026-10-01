import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { loadConfig, resolveConfig } from '../src/config';
import { globToRegExp } from '../src/glob';
import { ids, scanChange, scanEdit, tmpRepo } from './helpers';

const T = "it('a', () => {\n  expect(f()).toBe(1);\n});\n";

describe('config', () => {
  test('rules can be turned off or re-rated', () => {
    const after = T.replace("it('a'", "it.skip('a'");
    assert.deepEqual(ids(scanEdit('src/a.test.ts', T, after, { config: { rules: { 'test-skipped': 'off' } } })), []);
    const f = scanEdit('src/a.test.ts', T, after, { config: { rules: { 'test-skipped': 'low' } } });
    assert.equal(f[0].severity, 'low');
  });

  test('ignore globs skip paths', () => {
    const f = scanChange({ 'legacy/a.test.ts': T, 'src/a.test.ts': T }, { 'legacy/a.test.ts': null, 'src/a.test.ts': null }, { config: { ignore: ['legacy/**'] } });
    assert.deepEqual(f.map((x) => x.file), ['src/a.test.ts']);
  });

  test('testPatterns marks extra test files', () => {
    const c = "check('a', () => {});\nit('b', () => { expect(1 + 1).toBe(2); });\n";
    const f = scanChange({ 'checks/a.ts': c }, { 'checks/a.ts': null }, { config: { testPatterns: ['checks/**'] } });
    assert.deepEqual(ids(f), ['test-file-deleted']);
  });

  test('invalid settings throw', () => {
    assert.throws(() => resolveConfig({ rules: { x: 'nope' as any } }), /Invalid setting/);
    assert.throws(() => resolveConfig({ failOn: 'urgent' as any }), /Invalid failOn/);
  });

  test('loads .fakegreenrc.json and package.json#fakegreen', () => {
    const dir = tmpRepo({ '.fakegreenrc.json': JSON.stringify({ failOn: 'medium', rules: { 'error-swallowed': 'off' } }) });
    const c = loadConfig(dir);
    assert.equal(c.failOn, 'medium');
    assert.equal(c.rules['error-swallowed'], 'off');
    const dir2 = tmpRepo({ 'package.json': JSON.stringify({ name: 'x', fakegreen: { ignore: ['gen/**'] } }) });
    const c2 = loadConfig(dir2);
    assert.ok(c2.ignore[0].test('gen/a.ts'));
    assert.match(c2.source!, /package\.json#fakegreen$/);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
  });

  test('glob semantics', () => {
    assert.ok(globToRegExp('legacy/**').test('legacy/a/b.ts'));
    assert.ok(globToRegExp('*.gen.ts').test('src/deep/x.gen.ts'));
    assert.ok(!globToRegExp('/src/*.ts').test('lib/src/a.ts'));
    assert.ok(globToRegExp('vendor').test('vendor/x/y.go'));
    assert.ok(globToRegExp('**/*.{js,ts}').test('a/b.ts'));
  });
});

describe('inline fakegreen-ignore', () => {
  test('on the line above, scoped to a rule', () => {
    const after = T.replace("it('a'", "// fakegreen-ignore test-skipped -- upstream API down, tracked in #12\nit.skip('a'");
    assert.deepEqual(ids(scanEdit('src/a.test.ts', T, after)), ['ignore-comment-added']);
  });

  test('scoped to a different rule does not suppress', () => {
    const after = T.replace("it('a'", "// fakegreen-ignore suppression-added\nit.skip('a'");
    assert.deepEqual(ids(scanEdit('src/a.test.ts', T, after)).sort(), ['ignore-comment-added', 'test-skipped']);
  });

  test('a directive inside a string literal is neither honoured nor reported', () => {
    const after = T.replace("it('a'", "const s = 'fakegreen-ignore';\nit.skip('a'");
    assert.deepEqual(ids(scanEdit('src/a.test.ts', T, after)), ['test-skipped']);
  });

  test('fakegreen-ignore-file waives a whole file (still reported as low)', () => {
    const after = '// fakegreen-ignore-file: intentionally exercising skips\n' + T.replace("it('a'", "it.skip('a'");
    assert.deepEqual(ids(scanEdit('src/a.test.ts', T, after)), ['ignore-comment-added']);
  });
});
