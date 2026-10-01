import * as fs from 'fs';
import * as path from 'path';
import { globToRegExp } from './glob';
import { Severity } from './types';

export type RuleSetting = 'off' | Severity;

export interface UserConfig {
  /** Disable rules ("off") or override their severity. */
  rules?: Record<string, RuleSetting>;
  /** Glob patterns of paths to ignore entirely. */
  ignore?: string[];
  /** Extra glob patterns that identify test files. */
  testPatterns?: string[];
  /** Minimum severity that makes the command exit 1. */
  failOn?: Severity | 'none';
  /** Include untracked files in working-tree scans (default true). */
  untracked?: boolean;
}

export interface ResolvedConfig {
  rules: Record<string, RuleSetting>;
  ignore: RegExp[];
  testPatterns: RegExp[];
  failOn: Severity | 'none';
  untracked: boolean;
  source: string | null;
}

export const CONFIG_FILES = ['.fakegreenrc.json', '.fakegreenrc'];

export function loadConfig(root: string, explicit?: string): ResolvedConfig {
  let raw: UserConfig = {};
  let source: string | null = null;
  if (explicit) {
    source = path.resolve(explicit);
    raw = parseJson(source);
  } else {
    for (const name of CONFIG_FILES) {
      const p = path.join(root, name);
      if (fs.existsSync(p)) { source = p; raw = parseJson(p); break; }
    }
    if (!source) {
      const pkg = path.join(root, 'package.json');
      if (fs.existsSync(pkg)) {
        try {
          const j = JSON.parse(fs.readFileSync(pkg, 'utf8'));
          if (j && typeof j.fakegreen === 'object') { raw = j.fakegreen; source = pkg + '#fakegreen'; }
        } catch { /* ignore malformed package.json */ }
      }
    }
  }
  return resolveConfig(raw, source);
}

export function resolveConfig(raw: UserConfig, source: string | null = null): ResolvedConfig {
  const valid: RuleSetting[] = ['off', 'low', 'medium', 'high'];
  const rules: Record<string, RuleSetting> = {};
  for (const [k, v] of Object.entries(raw.rules ?? {})) {
    const val = (typeof v === 'boolean' ? (v ? undefined : 'off') : v) as RuleSetting | undefined;
    if (val === undefined) continue;
    if (!valid.includes(val)) throw new ConfigError(`Invalid setting for rule "${k}": ${JSON.stringify(v)} (expected off|low|medium|high)`);
    rules[k] = val;
  }
  const failOn = raw.failOn ?? 'high';
  if (!['low', 'medium', 'high', 'none'].includes(failOn)) throw new ConfigError(`Invalid failOn: ${JSON.stringify(failOn)}`);
  return {
    rules,
    ignore: (raw.ignore ?? []).map(globToRegExp),
    testPatterns: (raw.testPatterns ?? []).map(globToRegExp),
    failOn,
    untracked: raw.untracked !== false,
    source,
  };
}

export class ConfigError extends Error {}

function parseJson(p: string): UserConfig {
  try {
    const text = fs.readFileSync(p, 'utf8');
    // Allow // line comments in rc files.
    return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
  } catch (e) {
    throw new ConfigError(`Could not read config ${p}: ${(e as Error).message}`);
  }
}
