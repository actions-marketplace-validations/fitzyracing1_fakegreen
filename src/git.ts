import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { addedFileDiff } from './diff';
import { fileKind } from './lang';
import { FileDiff } from './types';

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export class GitError extends Error {}

export function git(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new GitError((err.stderr || err.message).toString().trim());
  }
}

function tryGit(args: string[], cwd: string): string | null {
  try { return git(args, cwd).trim(); } catch { return null; }
}

export function repoRoot(cwd: string): string {
  const r = tryGit(['rev-parse', '--show-toplevel'], cwd);
  if (!r) throw new GitError(`Not a git repository: ${cwd}`);
  return r;
}

export type DiffMode =
  | { kind: 'worktree' }
  | { kind: 'staged' }
  | { kind: 'base'; ref: string }
  | { kind: 'last-commit' }
  | { kind: 'commit'; sha: string };

export interface DiffSource {
  text: string;
  untracked: FileDiff[];
  description: string;
}

const DIFF_FLAGS = ['-c', 'core.quotepath=off', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', '-M', '-U3'];

function hasRef(ref: string, cwd: string): boolean {
  return tryGit(['rev-parse', '--verify', '-q', ref + '^{commit}'], cwd) !== null;
}

export function getDiff(mode: DiffMode, cwd: string, opts: { untracked?: boolean; maxFileBytes?: number } = {}): DiffSource {
  const root = repoRoot(cwd);
  const head = hasRef('HEAD', root);
  const run = (...args: string[]) => git([...DIFF_FLAGS, ...args], root);
  let text: string;
  let description: string;
  let includeUntracked = false;
  switch (mode.kind) {
    case 'worktree':
      text = run(head ? 'HEAD' : EMPTY_TREE);
      description = head ? 'uncommitted changes vs HEAD' : 'all files (no commits yet)';
      includeUntracked = true;
      break;
    case 'staged':
      text = run('--cached', head ? 'HEAD' : EMPTY_TREE);
      description = 'staged changes';
      break;
    case 'base': {
      if (!hasRef(mode.ref, root)) throw new GitError(`Unknown ref: ${mode.ref}`);
      const mb = head ? tryGit(['merge-base', mode.ref, 'HEAD'], root) : null;
      if (!mb) throw new GitError(`No merge base between ${mode.ref} and HEAD`);
      text = run(mb);
      description = `changes since merge-base with ${mode.ref} (${mb.slice(0, 7)})`;
      includeUntracked = true;
      break;
    }
    case 'last-commit':
    case 'commit': {
      const sha = mode.kind === 'commit' ? mode.sha : 'HEAD';
      if (!hasRef(sha, root)) throw new GitError(`Unknown commit: ${sha}`);
      const parent = hasRef(sha + '~1', root) ? sha + '~1' : EMPTY_TREE;
      text = run(parent, sha);
      const short = tryGit(['rev-parse', '--short', sha], root) ?? sha;
      description = mode.kind === 'commit' ? `commit ${short}` : `last commit (${short})`;
      break;
    }
  }
  const untracked = includeUntracked && opts.untracked !== false ? untrackedFiles(root, opts.maxFileBytes ?? 1024 * 1024) : [];
  if (untracked.length) description += ` + ${untracked.length} untracked file${untracked.length === 1 ? '' : 's'}`;
  return { text, untracked, description };
}

function untrackedFiles(root: string, maxBytes: number): FileDiff[] {
  const out = git(['-c', 'core.quotepath=off', 'ls-files', '--others', '--exclude-standard', '-z'], root);
  const files: FileDiff[] = [];
  // Only read files fakegreen would analyse; skip vendored/binary/doc paths up front.
  const rels = out.split('\0').filter((r) => r && fileKind(r) !== 'skip').slice(0, 5000);
  for (const rel of rels) {
    const abs = path.join(root, rel);
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > maxBytes) continue;
      const buf = fs.readFileSync(abs);
      if (buf.subarray(0, 8000).includes(0)) continue; // binary
      files.push(addedFileDiff(rel, buf.toString('utf8')));
    } catch { /* vanished */ }
  }
  return files;
}
