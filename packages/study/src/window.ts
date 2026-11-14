import type { Browser, Page } from 'playwright';
import { browserStartupArgs } from '../../adapters/src/browser.js';

// Start a real window, minimized for background runs. A headless browser cannot
// reveal its existing page; relaunching would lose pending quiz/submission state.
export const studyWindowOptions = (background: boolean) => ({
  headless: false,
  args: [...browserStartupArgs(), ...(background ? ['--start-minimized'] : [])],
});
export async function setStudyWindow(page: Page, minimized: boolean): Promise<void> {
  const client = await page.context().newCDPSession(page);
  try {
    const { windowId } = await client.send('Browser.getWindowForTarget');
    await client.send('Browser.setWindowBounds', { windowId, bounds: { windowState: minimized ? 'minimized' : 'normal' } });
    if (!minimized) await page.bringToFront();
  } finally { await client.detach(); }
}
export async function showStudyWindow(browser?: Browser): Promise<void> {
  const page = browser?.contexts().flatMap(c => c.pages()).filter(p => !p.isClosed()).at(-1);
  if (!page) throw new Error('当前没有运行窗口');
  await setStudyWindow(page, false);
}
