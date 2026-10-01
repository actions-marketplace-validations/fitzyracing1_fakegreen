/** Minimal gitignore-flavoured glob matcher: **, *, ?, {a,b}; patterns without "/" match at any depth. */
export function globToRegExp(pattern: string): RegExp {
  let p = pattern.trim().replace(/^\.\//, '');
  const anchored = p.startsWith('/');
  if (anchored) p = p.slice(1);
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        const slash = p[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = p.indexOf('}', i);
      if (end > i) {
        re += '(?:' + p.slice(i + 1, end).split(',').map(escape).join('|') + ')';
        i = end;
      } else re += '\\{';
    } else re += escape(c);
  }
  const prefix = anchored || p.includes('/') ? '^' : '^(?:.*/)?';
  return new RegExp(prefix + re + '(?:/.*)?$');
}

function escape(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

export function matchesAny(path: string, patterns: RegExp[]): boolean {
  return patterns.some((r) => r.test(path));
}
