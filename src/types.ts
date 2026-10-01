export type Severity = 'high' | 'medium' | 'low';

export const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

export type LineKind = '+' | '-' | ' ';

export interface DiffLine {
  kind: LineKind;
  /** Raw line text without the leading +/-/space marker. */
  text: string;
  /** Line number in the old file (removed + context lines). */
  oldNo?: number;
  /** Line number in the new file (added + context lines). */
  newNo?: number;
  /** Code with comments removed and string contents blanked out. Filled by the lexer. */
  code: string;
  /** Code with comments removed but string literals kept. */
  codeStr: string;
  /** Concatenated comment text found on this line. */
  comment: string;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed';

export interface FileDiff {
  oldPath: string | null;
  newPath: string | null;
  status: FileStatus;
  binary: boolean;
  similarity?: number;
  hunks: Hunk[];
}

export type FindingSide = 'added' | 'removed' | 'file';

export interface Finding {
  ruleId: string;
  severity: Severity;
  file: string;
  /** Line in the new file (or old file for removed lines when no new-side anchor exists). */
  line?: number;
  side: FindingSide;
  message: string;
  snippet?: string;
}

export type Lang = 'js' | 'py' | 'go' | 'rust' | 'java' | 'other';

export type FileKind = 'code' | 'ci' | 'config' | 'script' | 'skip';

export interface RuleMeta {
  id: string;
  severity: Severity;
  title: string;
  description: string;
}
