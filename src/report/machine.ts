import { ScanStats } from '../analyze';
import { RULES } from '../rules/registry';
import { Finding } from '../types';
import { countBySeverity } from './pretty';

export const VERSION: string = (() => {
  for (const rel of ['../../package.json', '../../../package.json']) {
    try {
      const pkg = require(rel);
      if (pkg.name === 'fakegreen') return pkg.version as string;
    } catch { /* try next */ }
  }
  return '0.0.0';
})();

export const HELP_URI = 'https://github.com/fitzyracing1/fakegreen#rules';

export function renderJson(findings: Finding[], stats: ScanStats, description: string, failed: boolean): string {
  return JSON.stringify({
    tool: 'fakegreen',
    version: VERSION,
    source: description,
    failed,
    summary: { ...countBySeverity(findings), total: findings.length, ...stats },
    findings,
  }, null, 2);
}

export function renderSarif(findings: Finding[]): string {
  const level = (s: Finding['severity']) => (s === 'high' ? 'error' : s === 'medium' ? 'warning' : 'note');
  const rules = RULES.map((r) => ({
    id: r.id,
    name: r.title.replace(/[^A-Za-z0-9]+(.)?/g, (_, ch: string | undefined) => (ch ? ch.toUpperCase() : '')),
    shortDescription: { text: r.title },
    fullDescription: { text: r.description },
    helpUri: `${HELP_URI}`,
    defaultConfiguration: { level: level(r.severity) },
    properties: { tags: ['fakegreen', 'tests', 'ai-agents'] },
  }));
  const index = new Map(rules.map((r, i) => [r.id, i]));
  return JSON.stringify({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'fakegreen', version: VERSION, informationUri: 'https://github.com/fitzyracing1/fakegreen', rules } },
      results: findings.map((f) => ({
        ruleId: f.ruleId,
        ruleIndex: index.get(f.ruleId),
        level: level(f.severity),
        message: { text: f.snippet ? `${f.message}\n${f.snippet}` : f.message },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: f.file },
            ...(f.line !== undefined ? { region: { startLine: f.line } } : {}),
          },
        }],
        partialFingerprints: { fakegreen: `${f.ruleId}:${f.file}:${(f.snippet ?? f.message).slice(0, 80)}` },
      })),
    }],
  }, null, 2);
}

/** GitHub Actions workflow commands, rendered as PR annotations. */
export function renderGithub(findings: Finding[]): string {
  const esc = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const escProp = (s: string) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
  return findings.map((f) => {
    const kind = f.severity === 'high' ? 'error' : f.severity === 'medium' ? 'warning' : 'notice';
    const props = [`file=${escProp(f.file)}`];
    if (f.line !== undefined) props.push(`line=${f.line}`);
    props.push(`title=${escProp(`fakegreen ${f.ruleId}`)}`);
    return `::${kind} ${props.join(',')}::${esc(f.snippet ? `${f.message}\n${f.snippet}` : f.message)}`;
  }).join('\n');
}
