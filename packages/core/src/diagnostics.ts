import { appendFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export type DiagnosticFacts = Record<string, string | number | boolean | null>;
// Only application-authored stages and structured facts belong in an export.
// Preserve the cause internally so wrappers do not erase the failure category.
export class DiagnosticError extends Error {
  constructor(message: string, readonly diagnosticStage: string, readonly diagnosticFacts: DiagnosticFacts = {}, options?: ErrorOptions) {
    super(message, options);
  }
}
export function diagnosticErrorFacts(error: unknown): DiagnosticFacts {
  const facts: DiagnosticFacts = {};
  const seen = new Set<Error>();
  for (let current = error; current instanceof Error && !seen.has(current) && seen.size < 5; current = current.cause) {
    seen.add(current);
    if (current instanceof DiagnosticError) {
      facts.failureStage ??= current.diagnosticStage;
      for (const [key,value] of Object.entries(current.diagnosticFacts)) facts[key] ??= value;
    }
    const kind = ['Error','TimeoutError','TypeError','ReferenceError','SyntaxError','ZodError','AbortError'].includes(current.name) ? current.name : 'Error';
    facts.errorType = kind;
    const operation = current.message.match(/^(page\.goto|locator\.(?:click|waitFor|evaluate|evaluateAll)|frame\.evaluate|apiRequestContext\.get):/);
    if (operation) facts.operation = operation[1];
    const timeout = current.message.match(/Timeout (\d{1,8})ms exceeded/i);
    if (timeout) facts.timeoutMs = Number(timeout[1]);
    const network = current.message.match(/\b(?:net::)?(ERR_[A-Z_]{3,60})\b/);
    if (network) facts.networkError = network[1];
    if (/ReferenceError: __name is not defined/.test(current.message)) facts.scriptError = 'missing-name-helper';
    if (seen.size > 1) facts.causeReason = diagnosticReason(current);
  }
  return facts;
}

// Export route templates, never arbitrary paths, queries, hashes or userinfo.
export function diagnosticLocation(value: string): DiagnosticFacts {
  try {
    const url = new URL(value);
    const path = url.pathname;
    const known = new Set(['/', '/home', '/app/cmgt/course', '/api/cmgt/course/my/bookshelf', '/api/portal/v1/homework/student-aggregation', '/api/portal/v1/exam/student-exams', '/api/v3/user/basic-info', '/mycourse/studentcourse', '/mycourse/studentstudy', '/exam/a/', '/exam/a/adminlogin', '/sso/login', '/sso/callback', '/_explorationpc_default/pc.html']);
    const endpoint = known.has(path) ? path : /^\/app\/cmgt\/resource-detail\/[^/]+\/?$/.test(path) ? '/app/cmgt/resource-detail/:id' : /^\/course(?:\/|$)/.test(path) ? '/course/*' : 'other';
    return {host:url.hostname, endpoint};
  } catch { return {host:'unknown',endpoint:'unknown'}; }
}

export function diagnosticReason(error: unknown): string {
  const seen = new Set<Error>();
  while (error instanceof Error && error.cause instanceof Error && !seen.has(error.cause) && seen.size < 5) {
    seen.add(error); error = error.cause;
  }
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
