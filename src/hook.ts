import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeDiffs, meetsThreshold } from './analyze';
import { loadConfig } from './config';
import { parseDiff } from './diff';
import { DiffMode, getDiff, repoRoot } from './git';
import { Finding, SEVERITY_RANK, Severity } from './types';

export type Agent = 'claude' | 'codex' | 'gemini';

export interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  stop_hook_active?: boolean;
  turn_id?: string;
  [k: string]: unknown;
}

export interface HookOutcome {
  /** JSON to print on stdout ('' = print nothing). */
  stdout: string;
  exitCode: number;
  findings: Finding[];
}

export function detectAgent(input: HookInput, explicit?: string): Agent {
  if (explicit === 'claude' || explicit === 'codex' || explicit === 'gemini') return explicit;
  if (input.hook_event_name === 'AfterAgent') return 'gemini';
  if (typeof input.turn_id === 'string') return 'codex';
  return 'claude';
}

/** The exact block response each agent understands for its end-of-turn hook. */
export function blockResponse(agent: Agent, reason: string): Record<string, unknown> {
  if (agent === 'gemini') return { decision: 'deny', reason };
  // Claude Code Stop and Codex Stop both use top-level decision/reason.
  return { decision: 'block', reason };
}

export function formatReason(findings: Finding[], failOn: Severity): string {
  const blocking = findings.filter((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[failOn]);
  const lines = [
    `fakegreen found ${blocking.length} change${blocking.length === 1 ? '' : 's'} in this turn's diff that make${blocking.length === 1 ? 's' : ''} the build look green without making it correct:`,
    '',
  ];
  for (const f of blocking.slice(0, 25)) {
    lines.push(`- [${f.severity}] ${f.ruleId} at ${f.file}${f.line !== undefined ? ':' + f.line : ''}: ${f.message}${f.snippet ? `  \`${f.snippet.split('\n').pop()!.slice(2, 122)}\`` : ''}`);
  }
  if (blocking.length > 25) lines.push(`- ...and ${blocking.length - 25} more (run \`npx fakegreen\` to see all)`);
  lines.push(
    '',
    'Fix the underlying problem instead: restore deleted or skipped tests, keep assertions specific, remove the suppressions, and do not special-case test environments or ignore CI failures.',
    'If one of these changes is genuinely intended, do not work around the check and do not add `fakegreen-ignore` comments yourself. Stop and explain to the user exactly why, so they can decide whether to approve it.',
  );
  return lines.join('\n');
}

function stateFile(sessionKey: string): string {
  const h = crypto.createHash('sha1').update(sessionKey).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `fakegreen-hook-${h}.json`);
}

function fingerprint(findings: Finding[]): string {
  return crypto.createHash('sha1').update(findings.map((f) => `${f.ruleId}|${f.file}|${f.snippet ?? f.message}`).sort().join('\n')).digest('hex');
}

export interface HookOptions {
  agent?: string;
  failOn?: Severity;
  mode?: DiffMode;
  /** For tests: supply the diff text directly. */
  diffText?: string;
}

export function runHook(rawInput: string, opts: HookOptions = {}): HookOutcome {
  let input: HookInput = {};
  try { input = rawInput.trim() ? JSON.parse(rawInput) : {}; } catch { input = {}; }
  const agent = detectAgent(input, opts.agent);
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const allow: HookOutcome = { stdout: '', exitCode: 0, findings: [] };
  let root: string;
  try {
    root = opts.diffText !== undefined ? cwd : repoRoot(cwd);
  } catch {
    return allow; // not a git repo: nothing to check
  }
  try {
    const config = loadConfig(root);
    const failOn = (opts.failOn ?? (config.failOn === 'none' ? 'high' : config.failOn)) as Severity;
    let diffs;
    if (opts.diffText !== undefined) diffs = parseDiff(opts.diffText);
    else {
      const src = getDiff(opts.mode ?? { kind: 'worktree' }, root, { untracked: config.untracked });
      diffs = [...parseDiff(src.text), ...src.untracked];
    }
    const { findings } = analyzeDiffs(diffs, config);
    if (!meetsThreshold(findings, failOn)) {
      clearState(input, root);
      return { ...allow, findings };
    }
    // Loop protection: if we already blocked this exact set of findings and the agent
    // stopped again without changing anything, let it stop but warn the user loudly.
    const key = `${agent}:${input.session_id ?? ''}:${root}`;
    const fp = fingerprint(findings);
    const sf = stateFile(key);
    let previous: string | null = null;
    try { previous = JSON.parse(fs.readFileSync(sf, 'utf8')).fingerprint; } catch { /* none */ }
    const n = findings.filter((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[failOn]).length;
    if (input.stop_hook_active && previous === fp) {
      const msg = `fakegreen: ${n} unresolved fake-green finding${n === 1 ? '' : 's'} remain after the agent was asked to fix them. Run \`npx fakegreen\` to review before trusting this turn.`;
      return { stdout: JSON.stringify({ systemMessage: msg }), exitCode: 0, findings };
    }
    try { fs.writeFileSync(sf, JSON.stringify({ fingerprint: fp, at: Date.now() })); } catch { /* best effort */ }
    const reason = formatReason(findings, failOn);
    return { stdout: JSON.stringify(blockResponse(agent, reason)), exitCode: 0, findings };
  } catch (e) {
    // Never break the agent because of a fakegreen error: fail open, but tell the user.
    return { stdout: JSON.stringify({ systemMessage: `fakegreen hook error: ${(e as Error).message}` }), exitCode: 0, findings: [] };
  }
}

function clearState(input: HookInput, root: string) {
  for (const a of ['claude', 'codex', 'gemini']) {
    try { fs.unlinkSync(stateFile(`${a}:${input.session_id ?? ''}:${root}`)); } catch { /* none */ }
  }
}
