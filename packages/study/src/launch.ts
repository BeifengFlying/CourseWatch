import type { BrowserContext, Page } from 'playwright';
import { StudyError } from './errors.js';
import { openUnipusCourses, openUnipusStudy } from './unipus-launch.js';
import { safePlatformUrl, type CourseRecord } from '../../contracts/src/index.js';
import { clickChapter, frameChapters } from './chapter-directory.js';
import { studyPageKind, type StudyPosition, type StudyPlatform } from '../../contracts/src/study.js';
// Use the portal's own links. Never construct learning/report URLs or invent
// class-to-resource relationships from a class name.
export async function openCourse(context: BrowserContext, platform: StudyPlatform, course?: Pick<CourseRecord, 'key' | 'name'>, directoryOnly = false, position?: Pick<StudyPosition, 'chapterId' | 'tabId'>): Promise<Page> {
  let page = await context.newPage();
  await page.goto(platform === 'chaoxing' ? 'https://i.chaoxing.com/' : 'https://uai.unipus.cn/home', { waitUntil: platform === 'unipus' ? 'commit' : 'domcontentloaded', timeout: 30000 });
  if (!course) return page;
  if (platform === 'unipus') {
    await openUnipusCourses(page);
    const book = page.getByText(course.name, { exact: true }).filter({ visible: true });
    await book.first().waitFor({ timeout: 15000 }).catch(() => { throw new StudyError('官网课程列表未找到所选教程，请重新同步课程后重试'); });
    if (await book.count() !== 1) throw new StudyError('官网存在同名教程，无法确认入口，请使用官方窗口选择');
    await book.click();
  } else {
    const ids = course.key.match(/^course:([^:]+):class:([^:]+)$/);
    if (!ids) throw new StudyError('课程标识无法识别，请重新同步课程');
    const href = await findChaoxingCourseURL(page, ids[1], ids[2]);
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await openChaoxingDirectory(page);
    return directoryOnly ? page : await openChaoxingChapter(context, page, position);
  }
  if (directoryOnly) return page;
  page = await openUnipusStudy(page, course.name);
  if (position) {
    const { jumpToStudyChapter } = await import('./navigation.js');
    if (!await jumpToStudyChapter(page, 'unipus', position.chapterId)) throw new StudyError('上次或所选章节未找到、尚未开放或未加载，请在官网选择章节');
  }
  return page;
}

// Some courses land on Activities instead of Chapters. Only use the visible
// official navigation; opening a directory never clicks a chapter or plays media.
export async function openChaoxingDirectory(page: Page, timeout = 12000): Promise<void> {
  const deadline = Date.now() + timeout;
  let clicked = false;
  do {
    for (const frame of page.frames()) {
      if (!safePlatformUrl('chaoxing', frame.url())) continue;
      if (/\/mycourse\/studentcourse\/?$/.test(new URL(frame.url()).pathname)) return;
      if (await frame.locator('.chapter_item[id^="cur"],#coursetree,h4[id^="cur"]').filter({visible:true}).count()) return;
      if (await frame.locator('input[type=password]').filter({visible:true}).count()) throw new StudyError('学习通登录已失效，请重新登录');
      if (!clicked) {
        const tab = frame.getByText('章节', {exact:true}).filter({visible:true});
        if (await tab.count() === 1) { await tab.click({timeout:5000}); clicked = true; break; }
      }
    }
    await page.waitForTimeout(300);
  } while (Date.now() < deadline);
  throw new StudyError('官网章节目录未加载，请在官方窗口打开课程的“章节”页后重试');
}

export async function openChaoxingChapter(context: BrowserContext, initialPage: Page, position?: Pick<StudyPosition, 'chapterId' | 'tabId'>): Promise<Page> {
  let page = initialPage, clicked = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    page = context.pages().filter(p => !p.isClosed()).at(-1) || page;
    if (studyPageKind(page.url()) === 'chapter') {
      await page.waitForLoadState('domcontentloaded');
      if (position) {
        const { jumpToStudyChapter } = await import('./navigation.js');
        let confirmed = false;
        for (let i = 0; i < 30; i++) {
          if (await jumpToStudyChapter(page, 'chaoxing', position.chapterId)) { confirmed = true; break; }
          await page.waitForTimeout(300);
        }
        if (!confirmed) throw new StudyError('上次或所选章节未找到、尚未开放或未加载，请在官网选择章节');
        if (position.tabId && /^dct\d+$/.test(position.tabId)) {
          const tab = page.locator(`#prev_tab [id="${position.tabId}"]`);
          if (await tab.count() !== 1 || !await tab.isVisible() || !await tab.isEnabled() || await tab.getAttribute('aria-disabled') === 'true') throw new StudyError('上次栏目未找到或尚未开放，请在官网选择栏目');
          const { selectNativeTab } = await import('./page.js');
          if (!await selectNativeTab(page, position.tabId)) throw new StudyError('上次栏目尚未加载，请在官网选择栏目');
        }
      }
      return page;
    }
    if (studyPageKind(page.url()) === 'login') throw new StudyError('学习通登录已失效，请重新登录');
    if (!clicked) for (const frame of page.frames()) {
      if (!safePlatformUrl('chaoxing', frame.url())) continue;
      const chapters = await frameChapters(frame, 'chaoxing');
      if (chapters.length) {
        const target = position ? chapters.find(c => c.id === position.chapterId) : chapters.find(c => !c.locked);
        if (position && (!target || target.locked)) throw new StudyError('上次或所选章节未找到或尚未开放，请在官网选择其他章节');
        if (target) { await clickChapter(frame, 'chaoxing', target); clicked = true; break; }
      }
      if (position) continue;
      // Delegate to the site's original handler (e.g. toOld), including its
      // own access checks. Do not evaluate handler arguments or construct URLs.
      const entries = frame.locator('.chapter_item[id^="cur"],.posCatalog_select[id^="cur"],h4[id^="cur"]').filter({visible:true});
      const index = await entries.evaluateAll(nodes => nodes.findIndex(row => {
        if (row.closest('[disabled],[aria-disabled="true"],.locked,.disabled,.chapter_locked')) return false;
        if (row.querySelector('.icon_lock,.icon-locked,.chapter-lock')) return false;
        return [row, ...row.querySelectorAll('[onclick],a[href]')].some(node =>
          /^(?:return\s+)?(?:window\.)?(?:toOld|getTeacherAjax)\s*\(/.test((node.getAttribute('onclick') || '').trim()));
      }));
      if (index >= 0) { await entries.nth(index).click({timeout:5000}); clicked = true; break; }
      const href = await frame.locator('a[href]').filter({visible:true}).evaluateAll(nodes => nodes.filter(n => !n.closest('[disabled],[aria-disabled="true"],.locked,.disabled,.chapter_locked') && !n.closest('.chapter_item,.posCatalog_select')?.querySelector('.icon_lock,.icon-locked,.chapter-lock')).map(n => (n as HTMLAnchorElement).href).find(href => {
        try { return /\/mycourse\/studentstudy\/?$/.test(new URL(href).pathname); } catch { return false; }
      }));
      if (href && studyPageKind(href) === 'chapter') { await page.goto(href, {waitUntil:'domcontentloaded',timeout:15000}); return page; }
    }
    await page.waitForTimeout(500);
  }
  throw new StudyError(clicked ? '已点击官网章节入口，但学习页面未加载，请在官方窗口检查访问限制或验证提示' : '未找到可用的官网章节入口，章节可能尚未开放，请在官方窗口核对');
}

// Course images and titles commonly link to the same URL. Match one destination,
// not one DOM node, and open the portal's Courses tab before looking for cards.
export async function findChaoxingCourseURL(page: Page, courseId: string, classId: string): Promise<string> {
  let menuOpened = false;
  for (let attempt = 0; attempt < 24; attempt++) {
    const destinations = new Set<string>();
    for (const frame of page.frames()) {
      if (!safePlatformUrl('chaoxing', frame.url())) continue;
      const links = await frame.locator('a[href]').filter({visible:true}).evaluateAll((nodes, ids) => nodes.flatMap(n => {
        try {
          const url = new URL((n as HTMLAnchorElement).href);
          const params = new Map([...url.searchParams].map(([k,v]) => [k.toLowerCase(),v]));
          return params.get('courseid') === ids[0] && (params.get('clazzid') || params.get('classid')) === ids[1]
            && /^\/(?:mooc-ans\/)?(?:visit\/stucoursemiddle|mycourse\/studentcourse)\/?$/.test(url.pathname) ? [url.href] : [];
        } catch { return []; }
      }), [courseId, classId]);
      for (const href of links) if (safePlatformUrl('chaoxing', href)) destinations.add(href);
      if (await frame.locator('input[type=password]').filter({visible:true}).count()) throw new StudyError('学习通登录已失效，请重新登录');
    }
    if (destinations.size === 1) return [...destinations][0];
    if (destinations.size > 1) throw new StudyError('官网存在多个不同课程入口，请在官方窗口核对');
    if (!menuOpened) for (const frame of page.frames()) {
      if (!safePlatformUrl('chaoxing', frame.url())) continue;
      const menu = frame.getByText('课程', {exact:true}).filter({visible:true});
      if (await menu.count() === 1) { await menu.click({timeout:5000}); menuOpened = true; break; }
    }
    await page.waitForTimeout(500);
  }
  throw new StudyError('官网课程列表中未找到所选课程，请重新同步课程后重试');
}
