import { beforeAll, afterAll, it, expect } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { skipStudyCheck } from '../packages/study/src/skip-check.js';
import { unipusFrames } from '../packages/study/src/unipus-page.js';
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ channel: 'chromium', headless: true }); });
afterAll(async () => { await browser.close(); });
it('无 API 的章节检测通过原生栏目跳过，不提交或标记完成', async () => {
 const page = await browser.newPage();
 await page.route('**/*', r => r.fulfill({ contentType:'text/html', body:`<ul id="prev_tab"><li id="dct1" class="active">检测</li><li id="dct2" onclick="document.querySelector('.active').classList.remove('active');this.classList.add('active')">视频</li></ul><button onclick="document.body.dataset.submitted='yes'">提交</button>` }));
 try {
  await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1');
  expect(await skipStudyCheck(page,'chaoxing',new AbortController().signal)).toBe(true);
  expect(await page.locator('#dct2').getAttribute('class')).toBe('active');
  expect(await page.locator('body').getAttribute('data-submitted')).toBeNull();
  expect(await page.locator('[data-completed=true]').count()).toBe(0);
 } finally { await page.close(); }
});
it('U校园内容中的单元检测可读取并跳至下一节，考试和身份验证仍暂停', async () => {
 const page = await browser.newPage();
 await page.route('**/*', r => r.fulfill({ contentType:'text/html; charset=utf-8', body:'<h1>单元检测 Unit test</h1><aside class="pc-slider-content-menu"><div class="pc-slider-menu-micro active">检测</div><div class="pc-slider-menu-micro" onclick="document.querySelector(\'.active\').classList.remove(\'active\');this.classList.add(\'active\')">视频</div></aside>' }));
 try {
  await page.goto('https://ucontent.unipus.cn/course/#/unit-test/1');
  expect(await unipusFrames(page)).toHaveLength(1);
  expect(await skipStudyCheck(page,'unipus',new AbortController().signal)).toBe(true);
  await page.locator('h1').evaluate(n => n.textContent='期末考试');
  await expect(skipStudyCheck(page,'unipus',new AbortController().signal)).rejects.toThrow('考试');
  await page.locator('h1').evaluate(n => n.textContent='单元检测');
  await page.locator('body').evaluate(n => n.insertAdjacentHTML('beforeend','<div data-captcha>验证</div>'));
  await expect(skipStudyCheck(page,'unipus',new AbortController().signal)).rejects.toThrow('验证');
 } finally { await page.close(); }
});
it('锁定的下一节和取消信号不触发跳转', async () => {
 const page = await browser.newPage();
 await page.route('**/*', r => r.fulfill({ contentType:'text/html', body:'<div id="cur1" class="posCatalog_select posCatalog_active"><span class="posCatalog_name">check</span></div><div id="cur2" class="posCatalog_select locked"><button class="posCatalog_name">video</button></div>' }));
 try {
  await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1');
  expect(await skipStudyCheck(page,'chaoxing',new AbortController().signal)).toBe(false);
  const abort = new AbortController(); abort.abort();
  await expect(skipStudyCheck(page,'chaoxing',abort.signal)).rejects.toThrow();
  expect(page.url()).toContain('chapterId=1');
 } finally { await page.close(); }
});
