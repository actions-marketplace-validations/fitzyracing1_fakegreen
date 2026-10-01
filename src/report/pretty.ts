import { ScanStats } from '../analyze';
import { Finding, SEVERITY_RANK, Severity } from '../types';
import { Colors } from './color';

export interface PrettyOptions {
  c: Colors;
  description: string;
  failOn: Severity | 'none';
  failed: boolean;
  elapsedMs?: number;
}

export function renderPretty(findings: Finding[], stats: ScanStats, o: PrettyOptions): string {
  const { c } = o;
  const out: string[] = [];
  const badge = (s: Severity) => (s === 'high' ? c.bgRed(' HIGH ') : s === 'medium' ? c.bgYellow(' MED  ') : c.bgBlue(' LOW  '));
  out.push('');
  out.push(`${c.bold('fakegreen')} ${c.gray('·')} ${o.description} ${c.gray(`· ${stats.analyzedFiles}/${stats.files} files · +${stats.added} −${stats.removed}`)}`);
  out.push('');
  if (!findings.length) {
    out.push(`  ${c.green('✔')} ${c.bold('No fake-green patterns found.')}`);
    out.push('');
    return out.join('\n');
  }
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file)!.push(f);
  }
  for (const [file, list] of byFile) {
    for (const f of list) {
      const loc = f.line !== undefined ? `${file}${c.gray(`:${f.line}`)}` : file;
      out.push(`  ${badge(f.severity)} ${c.bold(c.cyan(loc))}  ${c.magenta(f.ruleId)}`);
      out.push(`         ${f.message}`);
      if (f.snippet) {
        for (const s of f.snippet.split('\n')) {
          const col = s.startsWith('-') ? c.red : c.green;
          out.push(`         ${c.gray('│')} ${col(s)}`);
        }
      }
      out.push('');
    }
  }
  const counts = { high: 0, medium: 0, low: 0 } as Record<Severity, number>;
  for (const f of findings) counts[f.severity]++;
  const parts = [
    counts.high ? c.red(c.bold(`${counts.high} high`)) : c.gray('0 high'),
    counts.medium ? c.yellow(c.bold(`${counts.medium} medium`)) : c.gray('0 medium'),
    counts.low ? c.blue(`${counts.low} low`) : c.gray('0 low'),
  ];
  const verdict = o.failed
    ? c.red(c.bold(`✖ fake green detected`)) + c.gray(` (fail-on: ${o.failOn})`)
    : c.yellow(`⚠ review findings`) + c.gray(` (below fail-on: ${o.failOn})`);
  const time = o.elapsedMs !== undefined ? c.gray(` · ${o.elapsedMs}ms`) : '';
  out.push(`  ${parts.join(c.gray(' · '))}  ${verdict}${time}`);
  out.push('');
  return out.join('\n');
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts = { high: 0, medium: 0, low: 0 } as Record<Severity, number>;
  for (const f of findings) counts[f.severity]++;
  return counts;
}

export function filterMin(findings: Finding[], min: Severity): Finding[] {
  return findings.filter((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[min]);
}
