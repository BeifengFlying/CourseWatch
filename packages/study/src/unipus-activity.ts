// 严禁删除：用户要求保留 U校园每 5 分钟自动保活、普通超时确认及暂停保护。
// 受 study-protection.json 和 verify-study-protection.mjs 校验；修改须同步保护清单和行为测试。
import type { Page } from 'playwright';
import { unipusFrames } from './unipus-page.js';
import { unipusPageKind } from '../../contracts/src/study.js';

export const studyBrowserArgs = ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'];
export const UNIPUS_KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000;
const lastActivity = new WeakMap<Page, number>();
export const idleDialogText = /长时间未操作|长时间未学习|是否继续学习|继续学习|学习超时|学习已暂停/i;
const verificationText = /人脸|验证码|验证身份|身份验证|安全验证|本人|认证|captcha/i;

// Use the site's normal event handlers and continue button; never construct
// time-report requests, change scores, or alter authentication/verification.
export async function keepUnipusActive(page: Page, signal?: AbortSignal, now = performance.now()): Promise<boolean> {
  const guard = async () => { signal?.throwIfAborted(); await unipusFrames(page, true); signal?.throwIfAborted(); };
  await guard();
  const frames = await unipusFrames(page, true);
  if (!frames.length) return false;
  let confirmed = false;
  for (const frame of [page.mainFrame(), ...frames.filter(f => f !== page.mainFrame())]) {
    const dialogs = frame.locator('[role="dialog"]:visible,.el-dialog:visible,.modal:visible,.ant-modal:visible');
    for (const dialog of await dialogs.all()) {
      const text = await dialog.innerText();
      if (verificationText.test(text) || !idleDialogText.test(text)) continue;
      const buttons = dialog.getByRole('button', { name: /^(继续学习|继续|确定|确认|我知道了|Continue|Resume)$/i }).filter({ visible: true });
      if (await buttons.count() !== 1 || !await buttons.isEnabled()) throw new Error('U校园超时提示没有唯一的继续按钮，请手动处理');
      await guard();
      // DOM click invokes this verified native button without browser input
      // focusing/restoring the background window.
      await buttons.evaluate(node => (node as HTMLElement).click());
      await dialog.waitFor({ state: 'hidden', timeout: 3000 });
      confirmed = true;
    }
  }
  if (confirmed) for (const frame of frames) {
    await guard();
    await frame.locator('video,audio').evaluateAll(nodes => nodes.forEach(n => delete (n as HTMLElement).dataset.coursewatchPlayed));
  }
  if (!confirmed && now - (lastActivity.get(page) ?? -Infinity) < UNIPUS_KEEPALIVE_INTERVAL_MS) return false;
  await guard();
  // Background U校园 runs headless. Do not emulate focus or activate a target;
  // keepalive only invokes the content page's existing activity handlers.
  // Dispatch within the content frame: browser mouse input can activate a
  // minimized macOS window. These events never move the user's pointer.
  for (const frame of frames) {
    await guard();
    if (unipusPageKind(frame.url()) !== 'study') continue;
    await frame.evaluate(() => document.body?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 12, clientY: 12, view: window })));
  }
  lastActivity.set(page, now);
  return true;
}

export async function releaseUnipusActivity(page: Page) {
  lastActivity.delete(page);
}
