import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { readStudyProgress } from "../packages/study/src/progress.js";
let browser: Browser, page: Page;
const chapterURL = "https://mooc2-ans.chaoxing.com/mycourse/studentstudy?chapterId=1";
beforeAll(async () => { browser = await chromium.launch({ channel: "chromium", headless: true }); });
afterAll(async () => { await browser.close(); });
beforeEach(async () => {
  page = await browser.newPage();
  await page.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<div class="courseName">测试课程</div><div class="posCatalog_active"><span class="posCatalog_name">第一章</span><span class="icon_Completed">完成</span></div><div id="viewerContainer"><input id="pageNumber" value="2"><span id="numPages">5</span><button onclick="document.body.dataset.changed=\'true\'">下一页</button></div><video></video>' }));
  await page.goto(chapterURL);
});
afterEach(async () => { await page.close(); });
it("查询只读当前章节，页码、媒体和平台状态分别保留", async () => {
  const result = await readStudyProgress(page);
  expect(result).toMatchObject({ course: "测试课程", chapter: "第一章", chapterComplete: true, documents: [{ current: 2, total: 5 }], media: [{ kind: "video", current: 0, duration: null, paused: true, ended: false }] });
  expect(result!.observedAt).toBeGreaterThan(Date.now() - 5000);
  expect(await page.locator('#pageNumber').inputValue()).toBe("2");
  expect(await page.locator('body').getAttribute('data-changed')).toBeNull();
});
it("隐藏完成模板、缺失或异常页码不能变成完成或百分比", async () => {
  await page.locator('.icon_Completed').evaluate(el => (el as HTMLElement).hidden = true);
  await page.locator('#pageNumber').fill('8');
  expect(await readStudyProgress(page)).toMatchObject({ chapterComplete: null, documents: [{ current: null, total: 5 }] });
  await page.locator('#numPages').evaluate(el => el.textContent = '未加载');
  expect((await readStudyProgress(page))!.documents[0].total).toBeNull();
});
it("离开章节、进入考试或第三方页面时不沿用上一章的快照", async () => {
  for (const url of ['https://mooc2-ans.chaoxing.com/exam/doExam', 'https://i.chaoxing.com/', 'https://example.com/mycourse/studentstudy']) {
    await page.goto(url); expect(await readStudyProgress(page)).toBeNull();
  }
});

it("当前章节按 URL 标识定位，目录中的未知章节不计为完成", async () => {
  await page.locator('.posCatalog_active').evaluate(el => { el.id = 'cur1'; el.classList.add('posCatalog_select'); });
  await page.locator('body').evaluate(el => { el.insertAdjacentHTML('afterbegin', '<h4 class="posCatalog_select" id="cur0"><span class="posCatalog_name">前一章</span></h4><h4 class="posCatalog_select" id="cur2" data-completed="false"><span class="posCatalog_name">下一章</span></h4>'); });
  const result = await readStudyProgress(page);
  expect(result!.chapter).toBe('第一章');
  expect(result!.chapters.map(({tasks,...chapter}) => chapter)).toEqual([{ id: '0', name: '前一章', complete: null, locked: false }, { id: '2', name: '下一章', complete: false, locked: false }, { id: '1', name: '第一章', complete: true, locked: false }]);
});
