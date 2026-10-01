import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeDiffs } from '../src/analyze';
import { resolveConfig, UserConfig } from '../src/config';
import { parseDiff } from '../src/diff';
import { getDiff } from '../src/git';
import { Finding } from '../src/types';

export function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function tmpRepo(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakegreen-test-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 'test@example.com');
  sh(dir, 'config', 'user.name', 'Test');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  writeFiles(dir, files);
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

export function writeFiles(dir: string, files: Record<string, string | null>) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    if (content === null) { fs.rmSync(abs, { force: true }); continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

export interface ChangeOpts {
  config?: UserConfig;
  /** git add -A before diffing (enables rename detection). */
  stage?: boolean;
  /** Rename files with git mv before applying `after`: [from, to][] */
  moves?: [string, string][];
}

/** Commit `before`, apply `after` (null deletes), and scan the working tree. */
export function scanChange(before: Record<string, string>, after: Record<string, string | null>, opts: ChangeOpts = {}): Finding[] {
  const dir = tmpRepo(before);
  try {
    for (const [from, to] of opts.moves ?? []) {
      fs.mkdirSync(path.dirname(path.join(dir, to)), { recursive: true });
      sh(dir, 'mv', from, to);
    }
    writeFiles(dir, after);
    if (opts.stage) sh(dir, 'add', '-A');
    const src = getDiff({ kind: 'worktree' }, dir);
    return analyzeDiffs([...parseDiff(src.text), ...src.untracked], resolveConfig(opts.config ?? {})).findings;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Convenience: single file modified from `a` to `b`. */
export function scanEdit(file: string, a: string, b: string, opts: ChangeOpts = {}): Finding[] {
  return scanChange({ [file]: a }, { [file]: b }, opts);
}

/** Scan a raw unified diff string. */
export function scanDiff(diff: string, config: UserConfig = {}): Finding[] {
  return analyzeDiffs(parseDiff(diff), resolveConfig(config)).findings;
}

export function ids(fs: Finding[]): string[] {
  return fs.map((f) => f.ruleId);
}

export function only(fs: Finding[], rule: string): Finding[] {
  return fs.filter((f) => f.ruleId === rule);
}

export const lines = (...l: string[]) => l.join('\n') + '\n';
