/** Tiny LCS-based line diff for showing installer changes. Inputs are small config files. */
export function lineDiff(before: string, after: string, label: string): string {
  const a = before ? before.replace(/\n$/, '').split('\n') : [];
  const b = after.replace(/\n$/, '').split('\n');
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push('  ' + a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push('- ' + a[i]); i++; }
    else { ops.push('+ ' + b[j]); j++; }
  }
  while (i < n) ops.push('- ' + a[i++]);
  while (j < m) ops.push('+ ' + b[j++]);
  // Trim long unchanged runs to 3 lines of context.
  const keep = ops.map((o, k) => !o.startsWith('  ') || ops.slice(Math.max(0, k - 3), k + 4).some((x) => !x.startsWith('  ')));
  const out = [`--- ${before ? label : '/dev/null'}`, `+++ ${label}`];
  let skipped = false;
  ops.forEach((o, k) => {
    if (keep[k]) { out.push(o); skipped = false; }
    else if (!skipped) { out.push('  …'); skipped = true; }
  });
  return out.join('\n');
}
