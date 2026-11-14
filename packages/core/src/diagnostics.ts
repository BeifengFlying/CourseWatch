import { appendFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export function diagnosticReason(error: unknown): string {
  if (error instanceof Error && error.cause instanceof Error && error.cause !== error) error = error.cause;
  const text = error instanceof Error ? error.message : String(error ?? '');
  if (/intercepts pointer events/.test(text)) return 'pointer-blocked';
  if (/Timeout|timeout|超时/.test(text)) return 'timeout';
  if (/ERR_NAME_NOT_RESOLVED/.test(text)) return 'dns';
  if (/ERR_CONNECTION|fetch failed/.test(text)) return 'network';
  if (/Target.*closed|has been closed|已退出/.test(text)) return 'closed';
  if (/题目|弹题|测验|练习/.test(text)) return 'question';
  if (/验证|captcha/i.test(text)) return 'verification';
  if (/登录|session/i.test(text)) return 'session';
  return 'operation-failed';
}
// Export structured, allowlisted facts only. No raw exception, stack, response,
// cookie, storageState, model prompt, page text, account or authenticated URL.
export interface DiagnosticEvent {
  at: number; source: string; event: string; reason?: string; stage?: string;
  facts?: Record<string, string | number | boolean | null>;
}
export class DiagnosticLog {
  private file: string;
  private previous: string;
  private failed = false;
  constructor(dir: string, private limit = 512 * 1024) {
    this.file = join(dir, 'diagnostics.jsonl');
    this.previous = join(dir, 'diagnostics.previous.jsonl');
  }
  record(source: string, event: string, detail: Omit<DiagnosticEvent, 'at' | 'source' | 'event'> = {}) {
    const entry: DiagnosticEvent = { at: Date.now(), source, event, ...detail };
    try {
      const line = JSON.stringify(entry).slice(0, 12000) + '\n';
      if (existsSync(this.file) && statSync(this.file).size + Buffer.byteLength(line) > this.limit) {
        if (existsSync(this.previous)) unlinkSync(this.previous);
        renameSync(this.file, this.previous);
      }
      appendFileSync(this.file, line, { mode: 0o600 });
    } catch { this.failed = true; }
  }
  read() {
    const entries: DiagnosticEvent[] = [];
    for (const path of [this.previous, this.file]) {
      try {
        for (const line of readFileSync(path, 'utf8').split('\n')) {
          try { const entry = JSON.parse(line); if (typeof entry.at === 'number' && typeof entry.event === 'string') entries.push(entry); } catch { /* Ignore an interrupted final write. */ }
        }
      } catch { /* First run has no journal. */ }
    }
    return { entries: entries.slice(-500), writeFailed: this.failed };
  }
}
