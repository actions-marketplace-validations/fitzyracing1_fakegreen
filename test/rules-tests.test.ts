import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ids, lines, only, scanChange, scanEdit } from './helpers';

const JS_TESTS = lines(
  "import { add } from '../src/add';",
  "describe('add', () => {",
  "  it('adds positives', () => {",
  '    expect(add(1, 2)).toBe(3);',
  '  });',
  "  it('adds negatives', () => {",
  '    expect(add(-1, -2)).toBe(-3);',
  '  });',
  "  it('adds zero', () => {",
  '    expect(add(0, 0)).toBe(0);',
  '  });',
  '});',
);

describe('test-file-deleted', () => {
  test('flags a deleted test file', () => {
    const f = scanChange({ 'tests/add.test.ts': JS_TESTS, 'src/add.ts': 'export const add = (a, b) => a + b;\n' }, { 'tests/add.test.ts': null });
    const d = only(f, 'test-file-deleted');
    assert.equal(d.length, 1);
    assert.equal(d[0].severity, 'high');
    assert.match(d[0].message, /3 test cases/);
    assert.equal(d[0].side, 'file');
  });

  test('a renamed/moved test file is not a deletion (staged rename)', () => {
    const f = scanChange({ 'tests/add.test.ts': JS_TESTS }, {}, { moves: [['tests/add.test.ts', 'test/unit/add.spec.ts']], stage: true });
    assert.deepEqual(ids(f), []);
  });

  test('a moved test file is not a deletion (unstaged: delete + untracked add)', () => {
    const f = scanChange({ 'tests/add.test.ts': JS_TESTS }, { 'tests/add.test.ts': null, 'test/unit/add.spec.ts': JS_TESTS });
    assert.deepEqual(ids(f), []);
  });

  test('a test file split into two files is not a deletion', () => {
    const [head, ...rest] = JS_TESTS.split("  it('adds zero'");
    const partA = head + '});\n';
    const partB = "import { add } from '../src/add';\ndescribe('add', () => {\n  it('adds zero'" + rest.join('');
    const f = scanChange({ 'tests/add.test.ts': JS_TESTS }, { 'tests/add.test.ts': null, 'tests/add-a.test.ts': partA, 'tests/add-b.test.ts': partB });
    assert.deepEqual(only(f, 'test-file-deleted'), []);
    assert.deepEqual(only(f, 'test-count-dropped'), []);
  });

  test('deleted together with its source file is downgraded to medium', () => {
    const f = scanChange({ 'tests/add.test.ts': JS_TESTS, 'src/add.ts': 'export const add = (a, b) => a + b;\n' }, { 'tests/add.test.ts': null, 'src/add.ts': null });
    const d = only(f, 'test-file-deleted');
    assert.equal(d.length, 1);
    assert.equal(d[0].severity, 'medium');
  });

  test('python, go, rust, java test files', () => {
    const cases: Record<string, string> = {
      'tests/test_calc.py': 'def test_add():\n    assert add(1, 2) == 3\n',
      'calc/calc_test.go': 'package calc\nimport "testing"\nfunc TestAdd(t *testing.T) {\n\tif Add(1, 2) != 3 { t.Fatal("bad") }\n}\n',
      'tests/calc.rs': '#[test]\nfn adds() {\n    assert_eq!(add(1, 2), 3);\n}\n',
      'src/test/java/CalcTest.java': 'class CalcTest {\n  @Test\n  void adds() { assertEquals(3, add(1, 2)); }\n}\n',
    };
    for (const [file, content] of Object.entries(cases)) {
      const f = scanChange({ [file]: content }, { [file]: null });
      assert.equal(only(f, 'test-file-deleted').length, 1, file);
      assert.match(only(f, 'test-file-deleted')[0].message, /1 test case removed/, file);
    }
  });
});

describe('test-count-dropped', () => {
  test('flags removed test cases', () => {
    const after = JS_TESTS.replace("  it('adds negatives', () => {\n    expect(add(-1, -2)).toBe(-3);\n  });\n", '');
    const f = scanEdit('tests/add.test.ts', JS_TESTS, after);
    const d = only(f, 'test-count-dropped');
    assert.equal(d.length, 1);
    assert.equal(d[0].severity, 'high');
    assert.match(d[0].message, /dropped by 1/);
    assert.equal(d[0].line, 6);
  });

  test('renaming a test case is not a drop', () => {
    const f = scanEdit('tests/add.test.ts', JS_TESTS, JS_TESTS.replace("'adds zero'", "'adds zeros correctly'"));
    assert.deepEqual(ids(f), []);
  });

  test('commenting out a test is a drop and says so', () => {
    const after = JS_TESTS.replace("  it('adds zero', () => {\n    expect(add(0, 0)).toBe(0);\n  });", "  // it('adds zero', () => {\n  //   expect(add(0, 0)).toBe(0);\n  // });");
    const d = only(scanEdit('tests/add.test.ts', JS_TESTS, after), 'test-count-dropped');
    assert.equal(d.length, 1);
    assert.match(d[0].message, /commented out/);
  });

  test('moving a test case to another file is not a drop', () => {
    const block = "  it('adds zero', () => {\n    expect(add(0, 0)).toBe(0);\n  });\n";
    const after = JS_TESTS.replace(block, '');
    const other = "describe('zero', () => {\n" + block + '});\n';
    const f = scanChange({ 'tests/add.test.ts': JS_TESTS }, { 'tests/add.test.ts': after, 'tests/zero.test.ts': other });
    assert.deepEqual(only(f, 'test-count-dropped'), []);
  });

  test('test() calls in non-test files are not counted', () => {
    const src = "export function check(s) {\n  return /x/.test(s) && test(s);\n}\n";
    const f = scanEdit('src/check.ts', src, 'export function check(s) {\n  return true;\n}\n');
    assert.deepEqual(only(f, 'test-count-dropped'), []);
  });

  test('python def test_ dropped', () => {
    const a = 'def test_a():\n    assert f(1) == 1\n\n\ndef test_b():\n    assert f(2) == 2\n';
    const f = scanEdit('tests/test_f.py', a, 'def test_a():\n    assert f(1) == 1\n');
    assert.equal(only(f, 'test-count-dropped').length, 1);
  });

  test('rust #[test] dropped in an inline test module', () => {
    const a = 'pub fn f() -> u8 { 1 }\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn a() { assert_eq!(super::f(), 1); }\n    #[test]\n    fn b() { assert_eq!(super::f(), 1); }\n}\n';
    const b = 'pub fn f() -> u8 { 1 }\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn a() { assert_eq!(super::f(), 1); }\n}\n';
    assert.equal(only(scanEdit('src/lib.rs', a, b), 'test-count-dropped').length, 1);
  });

  test('go TestMain is not a test case', () => {
    const a = 'package x\nfunc TestMain(m *testing.M) { os.Exit(m.Run()) }\n';
    assert.deepEqual(only(scanEdit('x/main_test.go', a, 'package x\n'), 'test-count-dropped'), []);
  });
});

describe('test-skipped / test-focused', () => {
  const base = JS_TESTS;
  test('it.skip, describe.skip, xit, xdescribe, test.skip', () => {
    for (const [from, to] of [
      ["it('adds zero'", "it.skip('adds zero'"],
      ["describe('add'", "describe.skip('add'"],
      ["it('adds zero'", "xit('adds zero'"],
      ["describe('add'", "xdescribe('add'"],
    ]) {
      const f = scanEdit('tests/add.test.ts', base, base.replace(from, to));
      assert.deepEqual(ids(f), ['test-skipped'], to);
      assert.equal(f[0].severity, 'high');
    }
  });

  test('.only and fit are focus', () => {
    for (const to of ["it.only('adds zero'", "fit('adds zero'", "test.describe.only('adds zero'"]) {
      const f = scanEdit('tests/add.test.ts', base, base.replace("it('adds zero'", to));
      assert.ok(ids(f).includes('test-focused'), to);
    }
  });

  test('skip inside a string or comment is ignored', () => {
    const after = base.replace("it('adds zero'", "it('handles it.skip( in names and xit( too'") + "// TODO: maybe it.skip this later\nconst doc = `describe.only(...)`;\n";
    assert.deepEqual(ids(scanEdit('tests/add.test.ts', base, after)), []);
  });

  test('pre-existing skip that is merely moved is not reported', () => {
    const a = "it.skip('flaky', () => {});\nit('ok', () => { expect(1 + 1).toBe(2); });\n";
    const b = "it('ok', () => { expect(1 + 1).toBe(2); });\nit.skip('flaky', () => {});\n";
    assert.deepEqual(ids(scanEdit('tests/x.test.ts', a, b)), []);
  });

  test('stream.skip() and other .skip members are not tests', () => {
    const f = scanEdit('src/reader.ts', 'export const r = 1;\n', 'export const r = reader.skip(4);\nconst q = query.only();\n');
    assert.deepEqual(ids(f), []);
  });

  test('python skips', () => {
    const a = 'import pytest\n\ndef test_a():\n    assert f() == 1\n';
    for (const add of ['@pytest.mark.skip(reason="flaky")\n', '@pytest.mark.xfail\n', '@unittest.skip("x")\n']) {
      const f = scanEdit('tests/test_a.py', a, a.replace('def test_a', add + 'def test_a'));
      assert.deepEqual(ids(f), ['test-skipped'], add);
    }
    const inline = scanEdit('tests/test_a.py', a, a.replace('    assert f() == 1', '    pytest.skip("later")\n    assert f() == 1'));
    assert.deepEqual(ids(inline), ['test-skipped']);
    const cond = scanEdit('tests/test_a.py', a, a.replace('def test_a', '@pytest.mark.skipif(sys.platform == "win32", reason="posix")\ndef test_a'));
    assert.deepEqual(ids(cond), ['test-conditional-skip']);
  });

  test('go t.Skip (unconditional vs guarded)', () => {
    const a = 'package x\n\nfunc TestA(t *testing.T) {\n\tcheck(t)\n}\n';
    assert.deepEqual(ids(scanEdit('x/a_test.go', a, a.replace('\tcheck(t)', '\tt.Skip("todo")\n\tcheck(t)'))), ['test-skipped']);
    const guarded = scanEdit('x/a_test.go', a, a.replace('\tcheck(t)', '\tif testing.Short() {\n\t\tt.Skip("slow")\n\t}\n\tcheck(t)'));
    assert.deepEqual(ids(guarded), ['test-conditional-skip']);
  });

  test('call-form skips guarded by an if are conditional (low)', () => {
    const a = "describe('q', function () {\n  it('works', function () {\n    run();\n  });\n});\n";
    const f = scanEdit('test/q.js', a, a.replace('    run();', '    if (!supportsQuery()) {\n      this.skip()\n    }\n    run();'));
    assert.deepEqual(ids(f), ['test-conditional-skip']);
    assert.equal(f[0].severity, 'low');
    const py = 'def test_a():\n    assert f() == 1\n';
    const g = scanEdit('tests/test_a.py', py, py.replace('    assert', '    if sys.platform == "win32":\n        pytest.skip("posix only")\n    assert'));
    assert.deepEqual(ids(g), ['test-conditional-skip']);
  });

  test('node:test options object skip/only', () => {
    const a = "import test from 'node:test';\ntest('a', async () => {\n  assert.equal(f(), 1);\n});\n";
    assert.deepEqual(ids(scanEdit('test/a.test.js', a, a.replace("test('a', async", "test('a', { skip: true }, async"))), ['test-skipped']);
    assert.deepEqual(ids(scanEdit('test/a.test.js', a, a.replace("test('a', async", "test('a', { skip: 'flaky' }, async"))), ['test-skipped']);
    const c = scanEdit('test/a.test.js', a, a.replace("test('a', async", "test('a', { skip: isWindows }, async"));
    assert.deepEqual(ids(c), ['test-conditional-skip']);
    assert.deepEqual(ids(scanEdit('test/a.test.js', a, a.replace("test('a', async", "test('a', { only: true }, async"))), ['test-focused']);
    assert.deepEqual(ids(scanEdit('test/a.test.js', a, a.replace("test('a', async", "test('a', { timeout: 5000 }, async"))), []);
  });

  test('skipif(True) is an unconditional skip', () => {
    const py = 'def test_a():\n    assert f() == 1\n';
    const f = scanEdit('tests/test_a.py', py, '@pytest.mark.skipif(True, reason="broken")\n' + py);
    assert.deepEqual(ids(f), ['test-skipped']);
    const js = "it('a', () => {\n  expect(f()).toBe(1);\n});\n";
    assert.deepEqual(ids(scanEdit('src/a.test.ts', js, js.replace("it('a'", "it.skipIf(true)('a'"))), ['test-skipped']);
  });

  test('rust #[ignore] and java @Disabled/@Ignore', () => {
    const r = '#[test]\nfn a() { assert_eq!(f(), 1); }\n';
    assert.deepEqual(ids(scanEdit('tests/a.rs', r, '#[test]\n#[ignore]\nfn a() { assert_eq!(f(), 1); }\n')), ['test-skipped']);
    const j = 'class ATest {\n  @Test\n  void a() { assertEquals(1, f()); }\n}\n';
    assert.deepEqual(ids(scanEdit('src/test/java/ATest.java', j, j.replace('  @Test', '  @Disabled\n  @Test'))), ['test-skipped']);
    assert.deepEqual(ids(scanEdit('src/test/java/ATest.java', j, j.replace('  @Test', '  @Ignore\n  @Test'))), ['test-skipped']);
  });

  test('@JsonIgnore is not @Ignore', () => {
    const j = 'class Dto {\n  String name;\n}\n';
    assert.deepEqual(ids(scanEdit('src/main/java/Dto.java', j, j.replace('  String name;', '  @JsonIgnore\n  String name;'))), []);
  });
});
