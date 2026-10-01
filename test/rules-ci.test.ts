import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ids, only, scanChange, scanEdit } from './helpers';

const WF = `name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
      - run: npx tsc --noEmit
`;
const WFP = '.github/workflows/ci.yml';

describe('ci-failure-ignored', () => {
  test('|| true on a test command (high)', () => {
    const f = scanEdit(WFP, WF, WF.replace('run: npm test', 'run: npm test || true'));
    assert.deepEqual(ids(f), ['ci-failure-ignored']);
    assert.equal(f[0].severity, 'high');
    assert.equal(f[0].line, 9);
  });

  test('|| true on an unrelated command is low', () => {
    const f = scanEdit(WFP, WF, WF.replace('      - run: npm ci\n', '      - run: npm ci\n      - run: rm -rf .cache || true\n'));
    assert.equal(f[0].severity, 'low');
  });

  test('continue-on-error, allow_failure, --exit-zero', () => {
    const f = scanEdit(WFP, WF, WF.replace('      - run: npm test\n', '      - run: npm test\n        continue-on-error: true\n'));
    assert.deepEqual(ids(f), ['ci-failure-ignored']);
    const gl = 'test:\n  script:\n    - pytest\n';
    assert.deepEqual(ids(scanEdit('.gitlab-ci.yml', gl, gl + '  allow_failure: true\n')), ['ci-failure-ignored']);
    const mk = 'lint:\n\truff check .\n';
    assert.deepEqual(ids(scanEdit('Makefile', mk, mk.replace('ruff check .', 'ruff check . --exit-zero'))), ['ci-failure-ignored']);
  });

  test('package.json scripts', () => {
    const pkg = '{\n  "scripts": {\n    "test": "vitest run",\n    "lint": "eslint ."\n  }\n}\n';
    const f = scanEdit('package.json', pkg, pkg.replace('"vitest run"', '"vitest run || true"'));
    assert.deepEqual(ids(f), ['ci-failure-ignored']);
  });

  test('comment mentioning || true is ignored', () => {
    const f = scanEdit(WFP, WF, WF.replace('      - run: npm test\n', '      # never add || true here\n      - run: npm test\n'));
    assert.deepEqual(ids(f), []);
  });
});

describe('ci-step-removed / ci-step-disabled', () => {
  test('removed test step', () => {
    const f = scanEdit(WFP, WF, WF.replace('      - run: npm test\n', ''));
    const r = only(f, 'ci-step-removed');
    assert.equal(r.length, 1);
    assert.match(r[0].message, /npm test/);
  });

  test('swapping test runner is a migration, not a removal', () => {
    const f = scanEdit(WFP, WF, WF.replace('run: npm test', 'run: npx vitest run'));
    assert.deepEqual(ids(f), []);
  });

  test('moving the step to another workflow is fine', () => {
    const other = 'name: tests\non: [push]\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n';
    const f = scanChange({ [WFP]: WF }, { [WFP]: WF.replace('      - run: npm test\n', ''), '.github/workflows/tests.yml': other });
    assert.deepEqual(ids(f), []);
  });

  test('replaced by an unrecognised command is medium', () => {
    const f = scanEdit(WFP, WF, WF.replace('run: npm test', 'run: nub run verify'));
    assert.deepEqual(ids(f), ['ci-step-removed']);
    assert.equal(f[0].severity, 'medium');
    assert.match(f[0].message, /replaced by/);
  });

  test('replaced by echo is still a high removal', () => {
    const f = scanEdit(WFP, WF, WF.replace('run: npm test', 'run: echo "tests temporarily disabled"'));
    assert.equal(only(f, 'ci-step-removed')[0].severity, 'high');
  });

  test('yaml keys and maven args that merely contain tool names are not commands', () => {
    const m = 'jobs:\n  t:\n    strategy:\n      matrix:\n        include:\n          - {python: "3.13", tox: "py3.13"}\n          - {python: "3.14", tox: "py3.14"}\n';
    assert.deepEqual(ids(scanEdit(WFP, m, m.replace('          - {python: "3.14", tox: "py3.14"}\n', ''))), []);
    const g = 'jobs:\n  b:\n    steps:\n      - uses: x/build@v1\n        with:\n          extra-mvn-args: --projects \'!test-shrinker\'\n';
    assert.deepEqual(ids(scanEdit(WFP, g, g.replace("          extra-mvn-args: --projects '!test-shrinker'\n", ''))), []);
  });

  test('deleted workflow file that ran tests', () => {
    const f = scanChange({ [WFP]: WF }, { [WFP]: null });
    assert.deepEqual(ids(f), ['ci-step-removed']);
    assert.equal(f[0].side, 'file');
  });

  test('if: false disables a step', () => {
    const f = scanEdit(WFP, WF, WF.replace('      - run: npm test\n', '      - run: npm test\n        if: false\n'));
    assert.deepEqual(ids(f), ['ci-step-disabled']);
  });

  test('removed npm test script', () => {
    const pkg = '{\n  "scripts": {\n    "build": "tsc",\n    "test": "jest"\n  }\n}\n';
    const f = scanEdit('package.json', pkg, '{\n  "scripts": {\n    "build": "tsc"\n  }\n}\n');
    assert.ok(ids(f).includes('ci-step-removed'));
  });
});

describe('test-script-neutered / test-exclusion-added', () => {
  const pkg = '{\n  "scripts": {\n    "test": "jest"\n  }\n}\n';
  test('test script replaced with echo', () => {
    const f = scanEdit('package.json', pkg, pkg.replace('"jest"', '"echo \\"tests pass\\""'));
    assert.ok(ids(f).includes('test-script-neutered'));
  });
  test('npm init default (exit 1) is not neutered', () => {
    const f = scanChange({}, { 'package.json': '{\n  "scripts": {\n    "test": "echo \\"Error: no test specified\\" && exit 1"\n  }\n}\n' });
    assert.deepEqual(only(f, 'test-script-neutered'), []);
  });
  test('--passWithNoTests and -DskipTests', () => {
    const f = scanEdit('package.json', pkg, pkg.replace('"jest"', '"jest --passWithNoTests"'));
    assert.deepEqual(ids(f), ['test-exclusion-added']);
    assert.equal(f[0].severity, 'medium');
    const wf = WF.replace('run: npm test', 'run: mvn -B verify -DskipTests');
    const g = scanEdit(WFP, WF, wf);
    assert.ok(ids(g).includes('test-exclusion-added'));
    assert.equal(only(g, 'test-exclusion-added')[0].severity, 'high');
  });
  test('pytest --deselect / --ignore=tests', () => {
    const tox = '[testenv]\ncommands = pytest\n';
    assert.deepEqual(ids(scanEdit('tox.ini', tox, tox.replace('pytest', 'pytest --ignore=tests/integration'))), ['test-exclusion-added']);
  });
});

describe('coverage-threshold-lowered', () => {
  test('jest coverageThreshold lowered', () => {
    const cfg = 'module.exports = {\n  coverageThreshold: {\n    global: {\n      branches: 90,\n      lines: 90,\n    },\n  },\n};\n';
    const f = scanEdit('jest.config.js', cfg, cfg.replace('lines: 90', 'lines: 50'));
    const c = only(f, 'coverage-threshold-lowered');
    assert.equal(c.length, 1);
    assert.match(c[0].message, /lines 90 → 50/);
  });
  test('pyproject fail_under and --cov-fail-under', () => {
    const py = '[tool.coverage.report]\nfail_under = 85\n';
    assert.deepEqual(ids(scanEdit('pyproject.toml', py, py.replace('85', '60'))), ['coverage-threshold-lowered']);
    const wf = WF.replace('run: npm test', 'run: pytest --cov=app --cov-fail-under=80');
    assert.deepEqual(ids(scanEdit(WFP, wf, wf.replace('80', '20'))), ['coverage-threshold-lowered']);
  });
  test('raising the threshold is fine; unrelated "lines:" keys are ignored', () => {
    const py = '[tool.coverage.report]\nfail_under = 60\n';
    assert.deepEqual(ids(scanEdit('pyproject.toml', py, py.replace('60', '85'))), []);
    const y = 'editor:\n  lines: 120\n';
    assert.deepEqual(ids(scanEdit('.github/workflows/x.yml', y, y.replace('120', '80'))), []);
  });
  test('threshold removed entirely is medium', () => {
    const py = '[tool.coverage.report]\nshow_missing = true\nfail_under = 85\n';
    const f = scanEdit('pyproject.toml', py, '[tool.coverage.report]\nshow_missing = true\n');
    assert.equal(only(f, 'coverage-threshold-lowered')[0].severity, 'medium');
  });
});

describe('typecheck-weakened / lint-rule-disabled', () => {
  test('tsconfig strict false', () => {
    const ts = '{\n  "compilerOptions": {\n    "strict": true\n  }\n}\n';
    assert.deepEqual(ids(scanEdit('tsconfig.json', ts, ts.replace('true', 'false'))), ['typecheck-weakened']);
    assert.deepEqual(ids(scanEdit('tsconfig.json', ts, '{\n  "compilerOptions": {\n  }\n}\n')), ['typecheck-weakened']);
  });
  test('mypy ignore_errors', () => {
    const py = '[tool.mypy]\nstrict = true\n';
    assert.deepEqual(ids(scanEdit('pyproject.toml', py, py + 'ignore_errors = true\n')), ['typecheck-weakened']);
  });
  test('eslint rule off is low', () => {
    const js = 'export default [{ rules: {\n  "no-unused-vars": "error",\n} }];\n';
    const f = scanEdit('eslint.config.js', js, js.replace('"error"', '"off"'));
    assert.deepEqual(ids(f), ['lint-rule-disabled']);
  });
});
