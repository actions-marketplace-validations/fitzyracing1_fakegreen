import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { parseArgs } from '../src/cli';
import { sh, tmpRepo, writeFiles } from './helpers';

const CLI = path.join(__dirname, '..', '..', 'dist', 'cli.js');
const run = (cwd: string, args: string[], input?: string) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', input, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '' } });

const T = "it('a', () => {\n  expect(f()).toBe(1);\n});\n";

describe('cli', () => {
  let dir: string;
  before(() => {
    dir = tmpRepo({ 'src/a.test.ts': T, 'src/b.ts': 'export const b = 1;\n' });
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('clean tree exits 0', () => {
    const r = run(dir, []);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /No fake-green patterns found/);
  });

  test('high finding exits 1, --fail-on none exits 0, medium finding passes default', () => {
    writeFiles(dir, { 'src/a.test.ts': T.replace("it('a'", "it.skip('a'") });
    const r = run(dir, []);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /test-skipped/);
    assert.match(r.stdout, /src\/a\.test\.ts/);
    assert.equal(run(dir, ['--fail-on', 'none']).status, 0);
    writeFiles(dir, { 'src/a.test.ts': T, 'src/b.ts': '// @ts-ignore\nexport const b = 1;\n' });
    assert.equal(run(dir, []).status, 0);
    assert.equal(run(dir, ['--fail-on', 'medium']).status, 1);
    writeFiles(dir, { 'src/b.ts': 'export const b = 1;\n' });
  });

  test('--json and --sarif', () => {
    writeFiles(dir, { 'src/a.test.ts': T.replace("it('a'", "it.only('a'") });
    const j = JSON.parse(run(dir, ['--json']).stdout);
    assert.equal(j.tool, 'fakegreen');
    assert.equal(j.findings[0].ruleId, 'test-focused');
    assert.equal(j.findings[0].line, 1);
    assert.equal(j.summary.high, 1);
    assert.equal(j.failed, true);
    const s = JSON.parse(run(dir, ['--sarif']).stdout);
    assert.equal(s.version, '2.1.0');
    const res = s.runs[0].results[0];
    assert.equal(res.ruleId, 'test-focused');
    assert.equal(res.level, 'error');
    assert.equal(res.locations[0].physicalLocation.region.startLine, 1);
    assert.equal(s.runs[0].tool.driver.rules[res.ruleIndex].id, 'test-focused');
    const g = run(dir, ['--format', 'github']).stdout;
    assert.match(g, /^::error file=src\/a\.test\.ts,line=1,title=fakegreen test-focused::/m);
    writeFiles(dir, { 'src/a.test.ts': T });
  });

  test('untracked files are scanned (and can be excluded)', () => {
    writeFiles(dir, { 'src/new.ts': '// @ts-nocheck\nexport const n = 1;\n' });
    assert.equal(run(dir, []).status, 1);
    assert.equal(run(dir, ['--no-untracked']).status, 0);
    fs.rmSync(path.join(dir, 'src/new.ts'));
  });

  test('--staged only sees the index', () => {
    writeFiles(dir, { 'src/a.test.ts': T.replace("it('a'", "it.skip('a'") });
    assert.equal(run(dir, ['--staged']).status, 0);
    sh(dir, 'add', 'src/a.test.ts');
    assert.equal(run(dir, ['--staged']).status, 1);
    sh(dir, 'reset', '-q', 'src/a.test.ts');
    writeFiles(dir, { 'src/a.test.ts': T });
  });

  test('--last-commit, --commit and --base', () => {
    sh(dir, 'checkout', '-q', '-b', 'feature');
    writeFiles(dir, { 'src/a.test.ts': T.replace("it('a'", "xit('a'") });
    sh(dir, 'commit', '-qam', 'skip it');
    writeFiles(dir, { 'src/b.ts': 'export const b = 2;\n' });
    sh(dir, 'commit', '-qam', 'harmless');
    assert.equal(run(dir, ['--last-commit']).status, 0);
    assert.equal(run(dir, ['--commit', 'HEAD~1']).status, 1);
    const r = run(dir, ['--base', 'main']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /merge-base with main/);
    sh(dir, 'checkout', '-q', 'main');
  });

  test('--diff reads a patch from stdin', () => {
    const patch = 'diff --git a/x.test.js b/x.test.js\n--- a/x.test.js\n+++ b/x.test.js\n@@ -1 +1 @@\n-it("a", f)\n+it.skip("a", f)\n';
    const r = run(dir, ['--diff', '-', '--json'], patch);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).findings[0].ruleId, 'test-skipped');
  });

  test('errors exit 2', () => {
    const notRepo = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fg-norepo-'));
    const r = run(notRepo, []);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Not a git repository/);
    assert.equal(run(dir, ['--fail-on', 'urgent']).status, 2);
    assert.equal(run(dir, ['--staged', '--last-commit']).status, 2);
  });

  test('rules / --version / --help', () => {
    assert.match(run(dir, ['rules']).stdout, /test-file-deleted/);
    assert.match(run(dir, ['--version']).stdout, /^\d+\.\d+\.\d+/);
    assert.match(run(dir, ['--help']).stdout, /Usage/);
  });

  test('parseArgs handles = and aliases', () => {
    const a = parseArgs(['--base=origin/main', '-C', '/tmp', '--no-color', 'x']);
    assert.equal(a.flags.base, 'origin/main');
    assert.equal(a.flags.cwd, '/tmp');
    assert.equal(a.flags.color, false);
    assert.deepEqual(a._, ['x']);
  });
});
