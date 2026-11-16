import type { BrowserContext, Page } from 'playwright';
import { diagnosticErrorFacts, diagnosticLocation, diagnosticReason, type DiagnosticFacts } from '../../core/src/diagnostics.js';

export type BrowserDiagnosticReporter = (event: string, stage: string, reason?: string, facts?: DiagnosticFacts) => void;

export function watchBrowserDiagnostics(context: BrowserContext, report: BrowserDiagnosticReporter) {
  context.on('requestfailed', request => {
    if (!['document','xhr','fetch','media'].includes(request.resourceType())) return;
    const error = new Error(request.failure()?.errorText);
    report('request-failed', 'browser', diagnosticReason(error), {
      ...diagnosticLocation(request.url()), ...diagnosticErrorFacts(error),
      type:request.resourceType(), method:request.method(),
    });
  });
  context.on('response', response => {
    const request = response.request();
    if (response.status() < 400 || !['document','xhr','fetch','media'].includes(request.resourceType())) return;
    report('http-error', 'browser', undefined, {
      ...diagnosticLocation(response.url()), status:response.status(), type:request.resourceType(), method:request.method(),
    });
  });
  const watchPage = (page: Page) => page.on('pageerror', error => report('page-script-error', 'browser', diagnosticReason(error), diagnosticErrorFacts(error)));
  context.pages().forEach(watchPage);
  context.on('page', watchPage);
}

export async function reportBrowserFailure(error: unknown, stage: string, page: Page | undefined, report: BrowserDiagnosticReporter) {
  report('operation-failed', stage, diagnosticReason(error), diagnosticErrorFacts(error));
  if (!page || page.isClosed()) return;
  const frames = page.frames().slice(0,25);
  for (const [frameIndex,frame] of frames.entries()) {
    try {
      let frameVisible = true;
      for (let current = frame; current.parentFrame(); current = current.parentFrame()!) {
        const element = await current.frameElement();
        try { if (!await element.isVisible()) frameVisible = false; }
        finally { await element.dispose(); }
      }
      const facts = await frame.evaluate(() => {
        const {visible,count} = {
          visible(n: Element) { return !!n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden'; },
          count(selector: string) { return [...document.querySelectorAll(selector)].filter(visible).length; },
        };
        return {
          ready:document.readyState, videos:count('video'), questions:count('.TiMu,.singleQuesId,[data-questionid],.question-item,.question-common-abs-choice,.question-common-abs-fill-blank,.uls-sc__question'),
          videoPopups:count('.ans-videoquiz,.tkTopic,[data-video-quiz-root]'),
          dialogs:count('[role=dialog],.ucm-ant-modal-wrap,.el-dialog,.ant-modal'),
          passwordFields:count('input[type=password]'),
          verificationControls:count('.geetest_panel,.yidun_popup,.captcha-container,[data-captcha],.face-recognition,[data-face-verification]'),
          chapterNodes:document.querySelectorAll('.pc-slider-content-menu .pc-slider-menu-micro,.pc-slider-content-menu .pc-slider-menu-node,[role=tree] [role=treeitem],.posCatalog_select[id^=cur],h4[id^=cur]').length,
          visibleChapterNodes:count('.pc-slider-content-menu .pc-slider-menu-micro,.pc-slider-content-menu .pc-slider-menu-node,[role=tree] [role=treeitem],.posCatalog_select[id^=cur],h4[id^=cur]'),
          loadingIndicators:count('#root-loading,[aria-busy=true],.ant-spin-spinning'),
        };
      });
      report('page-state', stage, undefined, {...diagnosticLocation(frame.url()), frameIndex, topFrame:frame===page.mainFrame(), visible:frameVisible,...facts});
    } catch { /* Detached frames are expected during SSO navigation. */ }
  }
}
