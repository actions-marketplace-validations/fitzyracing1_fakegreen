import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { blockResponse, detectAgent, runHook } from '../src/hook';
import { tmpRepo, writeFiles } from './helpers';

const CLI = path.join(__dirname, '..', '..', 'dist', 'cli.js');
const T = "it('a', () => {\n  expect(f()).toBe(1);\n});\n";

function dirty() {
  const dir = tmpRepo({ 'src/a.test.ts': T });
  writeFiles(dir, { 'src/a.test.ts': T.replace("it('a'", "it.skip('a'") });
  return dir;
}

describe('hook', () => {
  test('agent detection', () => {
    assert.equal(detectAgent({ hook_event_name: 'AfterAgent' }), 'gemini');
    assert.equal(detectAgent({ hook_event_name: 'Stop', turn_id: 't1' }), 'codex');
    assert.equal(detectAgent({ hook_event_name: 'Stop' }), 'claude');
    assert.equal(detectAgent({ hook_event_name: 'Stop' }, 'gemini'), 'gemini');
  });

  test('block response formats', () => {
    assert.deepEqual(blockResponse('claude', 'r'), { decision: 'block', reason: 'r' });
    assert.deepEqual(blockResponse('codex', 'r'), { decision: 'block', reason: 'r' });
    assert.deepEqual(blockResponse('gemini', 'r'), { decision: 'deny', reason: 'r' });
  });

  test('clean repo: prints nothing, exit 0', () => {
    const dir = tmpRepo({ 'src/a.test.ts': T });
    const out = runHook(JSON.stringify({ hook_event_name: 'Stop', cwd: dir, session_id: 'clean' }), { agent: 'claude' });
    assert.equal(out.stdout, '');
    assert.equal(out.exitCode, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  for (const agent of ['claude', 'codex', 'gemini'] as const) {
    test(`${agent}: blocks with findings as feedback`, () => {
      const dir = dirty();
      const input = agent === 'gemini'
        ? { hook_event_name: 'AfterAgent', cwd: dir, session_id: 's-' + agent, prompt: 'fix tests', prompt_response: 'All tests pass!', stop_hook_active: false }
        : { hook_event_name: 'Stop', cwd: dir, session_id: 's-' + agent, stop_hook_active: false, ...(agent === 'codex' ? { turn_id: 't1' } : {}) };
      const r = spawnSync(process.execPath, [CLI, 'hook', '--agent', agent], { input: JSON.stringify(input), encoding: 'utf8' });
      assert.equal(r.status, 0);
      const j = JSON.parse(r.stdout);
      assert.equal(j.decision, agent === 'gemini' ? 'deny' : 'block');
      assert.match(j.reason, /test-skipped at src\/a\.test\.ts:1/);
      assert.match(j.reason, /explain to the user/);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }

  test('loop protection: same findings after a block -> allow with a user-visible warning', () => {
    const dir = dirty();
    const base = { hook_event_name: 'Stop', cwd: dir, session_id: 'loop-' + Date.now() };
    const first = JSON.parse(runHook(JSON.stringify({ ...base, stop_hook_active: false }), { agent: 'claude' }).stdout);
    assert.equal(first.decision, 'block');
    const second = JSON.parse(runHook(JSON.stringify({ ...base, stop_hook_active: true }), { agent: 'claude' }).stdout);
    assert.equal(second.decision, undefined);
    assert.match(second.systemMessage, /unresolved/);
    // if the agent changes things and still fakes it, it gets blocked again
    writeFiles(dir, { 'src/a.test.ts': T.replace("it('a'", "xit('a'") });
    const third = JSON.parse(runHook(JSON.stringify({ ...base, stop_hook_active: true }), { agent: 'claude' }).stdout);
    assert.equal(third.decision, 'block');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('not a git repo / garbage stdin: fail open silently', () => {
    const notRepo = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fg-hook-'));
    assert.equal(runHook(JSON.stringify({ cwd: notRepo })).stdout, '');
    const r = spawnSync(process.execPath, [CLI, 'hook'], { input: 'not json', cwd: notRepo, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  test('medium findings do not block by default', () => {
    const dir = tmpRepo({ 'src/b.ts': 'export const b = 1;\n' });
    writeFiles(dir, { 'src/b.ts': '// @ts-ignore\nexport const b = 1;\n' });
    assert.equal(runHook(JSON.stringify({ cwd: dir, session_id: 'm' }), { agent: 'claude' }).stdout, '');
    assert.equal(JSON.parse(runHook(JSON.stringify({ cwd: dir, session_id: 'm2' }), { agent: 'claude', failOn: 'medium' }).stdout).decision, 'block');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
