#!/usr/bin/env node
// Dev-only: run fakegreen over the last N non-merge commits of local clones and summarise noise.
// Usage: node scripts/dogfood.js <dir-with-clones> [N] [--details]
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { analyzeDiffs, parseDiff, resolveConfig, getDiff } = require('../dist');

const root = process.argv[2];
const N = parseInt(process.argv[3] || '100', 10);
const details = process.argv.includes('--details');
const config = resolveConfig({});
const totals = { commits: 0, flagged: 0, findings: 0, high: 0, medium: 0, low: 0, ms: 0 };
const byRule = {};
const rows = [];
for (const name of fs.readdirSync(root).sort()) {
  const dir = path.join(root, name);
  if (!fs.existsSync(path.join(dir, '.git'))) continue;
  const shas = execFileSync('git', ['log', '--no-merges', `-${N}`, '--format=%H'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const repo = { name, commits: 0, flagged: 0, high: 0, medium: 0, low: 0 };
  for (const sha of shas) {
    // skip the shallow boundary commit (its parent is missing)
    try { execFileSync('git', ['rev-parse', '-q', '--verify', sha + '~1'], { cwd: dir, stdio: 'ignore' }); } catch { continue; }
    const t0 = Date.now();
    const src = getDiff({ kind: 'commit', sha }, dir);
    const { findings } = analyzeDiffs(parseDiff(src.text), config);
    totals.ms += Date.now() - t0;
    repo.commits++; totals.commits++;
    if (findings.length) { repo.flagged++; totals.flagged++; }
    for (const f of findings) {
      repo[f.severity]++; totals[f.severity]++; totals.findings++;
      byRule[f.ruleId] = byRule[f.ruleId] || { high: 0, medium: 0, low: 0 };
      byRule[f.ruleId][f.severity]++;
      if (details) {
        const subj = execFileSync('git', ['log', '-1', '--format=%s', sha], { cwd: dir, encoding: 'utf8' }).trim();
        console.log(`${name} ${sha.slice(0, 8)} [${f.severity}] ${f.ruleId} ${f.file}:${f.line ?? ''} ${f.message}\n    ${subj}\n    ${(f.snippet || '').split('\n').join('\n    ')}`);
      }
    }
  }
  rows.push(repo);
}
console.log('\nrepo                 commits  flagged  high  medium  low');
for (const r of rows) console.log(`${r.name.padEnd(20)} ${String(r.commits).padStart(7)}  ${String(r.flagged).padStart(7)}  ${String(r.high).padStart(4)}  ${String(r.medium).padStart(6)}  ${String(r.low).padStart(3)}`);
console.log(`${'TOTAL'.padEnd(20)} ${String(totals.commits).padStart(7)}  ${String(totals.flagged).padStart(7)}  ${String(totals.high).padStart(4)}  ${String(totals.medium).padStart(6)}  ${String(totals.low).padStart(3)}`);
console.log('\nby rule:', JSON.stringify(byRule, null, 1));
console.log(`avg ${(totals.ms / Math.max(1, totals.commits)).toFixed(1)} ms/commit`);
