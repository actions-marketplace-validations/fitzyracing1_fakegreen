export interface Colors {
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  blue(s: string): string;
  magenta(s: string): string;
  cyan(s: string): string;
  gray(s: string): string;
  bgRed(s: string): string;
  bgYellow(s: string): string;
  bgBlue(s: string): string;
  bgGreen(s: string): string;
}

export function shouldColor(stream: NodeJS.WriteStream, flag?: boolean): boolean {
  if (flag !== undefined) return flag;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') return true;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  return !!stream.isTTY && process.env.TERM !== 'dumb';
}

export function colors(enabled: boolean): Colors {
  const w = (open: string, close: string) => (s: string) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s);
  return {
    bold: w('1', '22'),
    dim: w('2', '22'),
    red: w('31', '39'),
    green: w('32', '39'),
    yellow: w('33', '39'),
    blue: w('34', '39'),
    magenta: w('35', '39'),
    cyan: w('36', '39'),
    gray: w('90', '39'),
    bgRed: w('41;97;1', '49;39;22'),
    bgYellow: w('43;30;1', '49;39;22'),
    bgBlue: w('44;97;1', '49;39;22'),
    bgGreen: w('42;30;1', '49;39;22'),
  };
}
