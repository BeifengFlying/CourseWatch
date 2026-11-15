import type { BrowserContext, Page } from 'playwright';
import { watchBrowserDiagnostics, reportBrowserFailure, type BrowserDiagnosticReporter } from '../../adapters/src/browser-diagnostics.js';

const report: BrowserDiagnosticReporter = (event, stage, reason, facts) =>
  process.send?.({ diagnostic: { event, stage, reason, facts } });
export function watchStudyBrowser(context: BrowserContext) {
  watchBrowserDiagnostics(context, report);
}
export async function reportStudyFailure(error: unknown, stage: string, page?: Page) {
  await reportBrowserFailure(error, stage, page, report);
}
