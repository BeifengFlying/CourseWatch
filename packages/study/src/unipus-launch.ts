import type { Page } from 'playwright';
import { StudyError } from './errors.js';
import { unipusPageKind, unipusStudyFrame } from '../../contracts/src/study.js';
import { DiagnosticError } from '../../core/src/diagnostics.js';

export async function openUnipusCourses(page: Page, timeout = 20000): Promise<void> {
  let step = '等待首页导航';
  try {
    const menu = page.getByText('我的课程', { exact: true }).filter({ visible: true });
    await menu.first().waitFor({ timeout });
    step = '等待首页加载';
    await page.locator('#root-loading').waitFor({ state: 'hidden', timeout });
    // This exact informational notice is shown on every restored session.
    // Never dismiss arbitrary dialogs, login, consent or identity verification.
    const notice = page.locator('.ucm-ant-modal-wrap').filter({ visible: true })
      .filter({ hasText: '网页端已关闭激活教程功能，如有需要请移步App端进行教程激活' });
    if (await notice.count() === 1) {
      const ack = notice.getByRole('button', { name: '知道了', exact: true });
      if (await ack.count() === 1) {
        step = '关闭激活教程提示';
        await ack.click({ timeout: 3000 });
        await notice.waitFor({ state: 'hidden', timeout: 3000 });
      }
    }
    const blockers = page.locator('.ucm-ant-modal-wrap,[role=dialog]').filter({ visible: true });
    if (await blockers.count()) throw new StudyError('U校园首页有待处理的提示，请打开运行窗口查看后继续');
    if (await menu.count() !== 1) throw new StudyError('未找到唯一的“我的课程”入口，请打开运行窗口选择教程');
    step = '打开我的课程';
    await menu.click({ timeout: 5000 });
    step = '等待校内课程列表';
    await page.getByText('校内课程', { exact: true }).filter({ visible: true }).waitFor({ timeout });
  } catch (error) {
    const cause = new DiagnosticError('U校园课程导航未完成', 'unipus-courses', {step}, {cause:error});
    if (error instanceof StudyError) throw new StudyError(error.message, {cause});
    if (await page.locator('input[type=password]').filter({ visible: true }).count().catch(() => 0))
      throw new StudyError('U校园登录已失效，请在平台设置中重新登录', {cause});
    throw new StudyError(`U校园${step}未完成，请打开运行窗口检查提示或网络后重试`, {cause});
  }
}

// A content-domain URL can be the empty application shell before SSO redirects.
// Confirm a rendered task or directory instead of reporting that shell as ready.
export async function unipusContentReady(page: Page): Promise<boolean> {
  for (const frame of page.frames().filter(f => unipusStudyFrame(f.url()))) {
    try {
      if (await frame.locator('.pc-slider-content-menu .pc-slider-menu-micro,.pc-slider-content-menu .pc-slider-menu-node,[role="tree"] [role="treeitem"],video,audio,.question-wrap,.question-container,.question-item,.question[data-question-id],.reading-content,.reading-material,.article-content').filter({visible:true}).count()) return true;
    } catch (error) {
      if (page.isClosed() || !/context was destroyed|Frame was detached|Execution context/i.test((error as Error).message)) throw error;
    }
  }
  return false;
}

export async function openUnipusStudy(initialPage: Page, courseName: string, timeout = 25000): Promise<Page> {
  const context = initialPage.context();
  let page = initialPage, entered = false, contentOpened = false;
  const deadline = Date.now() + timeout;
  do {
    page = context.pages().filter(p => !p.isClosed()).at(-1) || page;
    const kinds = page.frames().map(f => unipusPageKind(f.url()));
    if (kinds.includes('exam')) throw new StudyError('教程入口打开了考试或测评，请在运行窗口核对');
    if (kinds.includes('login')) {
      // SSO callbacks can briefly use a login route while restoring a valid
      // session. A rendered password/verification form still needs the user.
      const loginForm = await page.locator('input[type=password],.captcha-container,[data-captcha],.face-recognition').filter({visible:true}).count();
      if (loginForm || Date.now() + 300 >= deadline) throw new StudyError('U校园内容页需要重新登录，请打开运行窗口处理');
      await page.waitForTimeout(300); continue;
    }
    if (kinds.includes('study')) { contentOpened = true; if (await unipusContentReady(page)) return page; }
    const url = new URL(page.url());
    const detail = url.pathname.match(/^\/app\/cmgt\/resource-detail\/([^/]+)\/?$/);
    if (url.origin === 'https://uai.unipus.cn' && detail && !entered) {
      // The bookshelf resourceId and detail route ID are different identifiers.
      // Follow the unique card's native navigation, then confirm its rendered title.
      const title = page.getByText(courseName, { exact: true }).filter({ visible: true });
      if (await title.count() > 1) throw new StudyError('教程详情页有同名项，无法确认学习入口，请在运行窗口选择');
      if (await title.count() !== 1) { await page.waitForTimeout(300); continue; }
      const button = page.getByRole('button', { name: /^(继续学习|开始学习|进入学习)$/ }).filter({ visible: true });
      const count = await button.count();
      if (count > 1) throw new StudyError('教程详情页有多个学习入口，请在运行窗口选择');
      if (count === 1) { await button.click({ timeout: 5000 }); entered = true; }
    }
    await page.waitForTimeout(300);
  } while (Date.now() < deadline);
  throw new StudyError(entered || contentOpened ? '已点击官网学习入口，但内容页未加载，请打开运行窗口检查' : '教程详情页未找到可用的学习入口，请打开运行窗口检查');
}
