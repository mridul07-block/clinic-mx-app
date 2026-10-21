/** One broken design rule, reported as `file:line  rule  message`. */
export interface Problem {
  file: string;
  line: number;
  rule: string;
  message: string;
}
