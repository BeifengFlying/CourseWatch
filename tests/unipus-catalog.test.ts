import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { readUnipusCourseCatalog } from '../packages/study/src/catalog.js';
import { diagnosticErrorFacts } from '../packages/core/src/diagnostics.js';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({channel:'chromium',headless:true}); });
afterAll(async () => { await browser.close(); });
const course = {id:'book',name:'模拟教程',platform:'unipus' as const};
const card = `<div><a href="/app/cmgt/resource-detail/detail-id">模拟教程</a><p>已学任务：2/10</p><p>学习进度：20%</p></div>`;

it.each([false,true])('从课程卡片进入教程读取延迟加载的章节，支持新窗口 %s', async popup => {
  const context = await browser.newContext();
  try {
    let writes = 0;
    await context.route('**/*', route => {
      if (route.request().method() !== 'GET') writes++;
      const path = new URL(route.request().url()).pathname;
      const body = path === '/home' ? card : path.includes('/resource-detail/')
        ? `<h1>模拟教程</h1><button onclick="${popup ? "window.open('https://uai.unipus.cn/learning')" : "location.href='https://uai.unipus.cn/learning'"}">继续学习</button>`
        : path === '/learning' ? '<iframe src="https://ucontent.unipus.cn/course/reading"></iframe>'
        : `<article class="reading-content">模拟正文</article><script>setTimeout(()=>document.body.insertAdjacentHTML('beforeend','<aside class="pc-slider-content-menu"><div class="pc-slider-menu-node" data-id="unit1"><span>Unit 1</span><div class="pc-slider-menu-micro active" data-id="reading" data-completed="true"><span class="pc-menu-node-name">Reading</span></div><div class="pc-slider-menu-micro locked" data-id="listen">Listening</div></div></aside>'),400)</script>`;
      return route.fulfill({contentType:'text/html; charset=utf-8',body});
    });
    const page = await context.newPage(); await page.goto('https://uai.unipus.cn/home');
    const progress = await readUnipusCourseCatalog(page,course,3000);
    expect(progress).toMatchObject({completed:2,total:10,percent:20,chapters:[
      {id:'reading',name:'Reading',complete:true,locked:false,path:[{id:'unit1',name:'Unit 1'}]},
      {id:'listen',name:'Listening',complete:null,locked:true},
    ]});
    expect(writes).toBe(0);
  } finally { await context.close(); }
});

it('正文已加载但没有目录时返回具体阶段，不以卡片进度作为目录成功', async () => {
  const page = await browser.newPage();
  try {
    await page.route('**/*', route => route.fulfill({contentType:'text/html; charset=utf-8',body:
      new URL(route.request().url()).pathname === '/home' ? card.replace('/app/cmgt/resource-detail/detail-id','https://ucontent.unipus.cn/course/reading') : '<article class="reading-content">模拟正文</article>'}));
    await page.goto('https://uai.unipus.cn/home');
    const error = await readUnipusCourseCatalog(page,course,350).catch(error => error);
    expect(error.message).toContain('章节目录未加载');
    expect(diagnosticErrorFacts(error)).toMatchObject({failureStage:'unipus-catalog',step:'read-chapter-directory'});
  } finally { await page.close(); }
});

it('教程登录失效或要求人工验证时保留失败，不返回空目录成功', async () => {
  for (const content of ['<input type="password">','<article class="reading-content">正文</article><div data-captcha>验证</div>']) {
    const page = await browser.newPage();
    try {
      await page.route('**/*', route => route.fulfill({contentType:'text/html; charset=utf-8',body:
        new URL(route.request().url()).pathname === '/home' ? card.replace('/app/cmgt/resource-detail/detail-id','https://ucontent.unipus.cn/course/reading') : content}));
      await page.goto('https://uai.unipus.cn/home');
      await expect(readUnipusCourseCatalog(page,course,350)).rejects.toThrow(/登录|验证|内容页未加载/);
    } finally { await page.close(); }
  }
});
