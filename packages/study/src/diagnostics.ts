import type { BrowserContext, Page } from 'playwright';
import { diagnosticReason } from '../../core/src/diagnostics.js';
import { visibleFrame } from './visible-frame.js';

const report = (event: string, stage: string, reason?: string, facts?: Record<string, string | number | boolean | null>) =>
  process.send?.({ diagnostic: { event, stage, reason, facts } });
export function watchStudyBrowser(context: BrowserContext) {
  context.on('requestfailed', request => {
    if (!['document', 'xhr', 'fetch', 'media'].includes(request.resourceType())) return;
    let host = ''; try { host = new URL(request.url()).hostname; } catch { return; }
    report('request-failed', 'browser', diagnosticReason(new Error(request.failure()?.errorText)), { host, type: request.resourceType() });
  });
  context.on('response', response => {
    if (response.status() < 400 || !['document', 'xhr', 'fetch', 'media'].includes(response.request().resourceType())) return;
    report('http-error', 'browser', undefined, { host: new URL(response.url()).hostname, status: response.status(), type: response.request().resourceType() });
  });
  context.on('page', page => page.on('pageerror', () => report('page-script-error', 'browser')));
}
export async function reportStudyFailure(error: unknown, stage: string, page?: Page) {
  report('operation-failed', stage, diagnosticReason(error));
  if (!page || page.isClosed()) return;
  for (const frame of page.frames().slice(0, 25)) {
    try {
      const url = new URL(frame.url());
      const facts = await frame.evaluate(() => ({
        ready: document.readyState,
        videos: document.querySelectorAll('video').length,
        questions: document.querySelectorAll('.TiMu,.singleQuesId,[data-questionid],.question-item').length,
        videoPopups: document.querySelectorAll('.ans-videoquiz,.tkTopic,[data-video-quiz-root]').length,
        dialogs: [...document.querySelectorAll('[role=dialog],.ucm-ant-modal-wrap')].filter(n => !!n.getClientRects().length).length,
      }));
      report('page-state', stage, undefined, { host: url.hostname, visible: await visibleFrame(frame), ...facts });
    } catch { /* Detached and blank frames are normal during navigation. */ }
  }
}
