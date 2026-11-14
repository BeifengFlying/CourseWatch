import { browserStartupArgs } from '../packages/adapters/src/browser.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { openUnipusCourses, openUnipusStudy } from '../packages/study/src/unipus-launch.js';
import { setStudyWindow, studyWindowOptions } from '../packages/study/src/window.js';
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ channel: 'chromium', headless: true }); });
afterAll(async () => { await browser.close(); });
it('等待首页加载，关闭已确认的激活提示后打开我的课程', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`<div id="root-loading" style="position:fixed;inset:0">加载中</div><div class="ucm-ant-modal-wrap" style="position:fixed;inset:0">网页端已关闭激活教程功能，如有需要请移步App端进行教程激活<button onclick="this.parentElement.remove()">知道了</button></div><button onclick="document.body.insertAdjacentHTML('beforeend','<div>校内课程</div>')">我的课程</button><script>setTimeout(()=>document.querySelector('#root-loading').remove(),100)</script>`);
    await openUnipusCourses(page, 2000);
    expect(await page.getByText('校内课程', { exact: true }).count()).toBe(1);
    expect(await page.locator('.ucm-ant-modal-wrap').count()).toBe(0);
  } finally { await page.close(); }
});
it('未知提示和本人验证不能按同名知道了自动关闭', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`<div class="ucm-ant-modal-wrap" role="dialog">请本人确认身份<button onclick="document.body.dataset.clicked='yes'">知道了</button></div><button>我的课程</button>`);
    await expect(openUnipusCourses(page, 500)).rejects.toThrow('待处理的提示');
    expect(await page.locator('body').getAttribute('data-clicked')).toBeNull();
  } finally { await page.close(); }
});
it('所选教程详情还须点击官方继续学习，支持新窗口及内容 iframe', async () => {
 const context = await browser.newContext();
 try {
  await context.route('**/*', r => r.fulfill({contentType:'text/html; charset=utf-8',body:r.request().url().includes('/resource-detail/')
   ? '<h1>模拟教程</h1><button onclick="window.open(\'https://uai.unipus.cn/learning\')">继续学习</button>'
   : r.request().url().includes('/learning') ? '<iframe src="https://ucontent.unipus.cn/course/reading"></iframe>' : '<article class="reading-content">教程内容</article>'}));
  const page = await context.newPage();await page.goto('https://uai.unipus.cn/app/cmgt/resource-detail/123');
  const opened = await openUnipusStudy(page, '模拟教程', 3000);
  expect(context.pages()).toHaveLength(2);
  expect(opened.frames().some(f=>f.url().startsWith('https://ucontent.unipus.cn/'))).toBe(true);
 } finally { await context.close(); }
});
it('教程名称无法确认不点击学习入口', async () => {
 const page = await browser.newPage();
 try {
  await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<button onclick="document.body.dataset.entered=\'yes\'">继续学习</button>'}));
  await page.goto('https://uai.unipus.cn/app/cmgt/resource-detail/wrong');
  await expect(openUnipusStudy(page, '模拟教程', 1000)).rejects.toThrow('学习入口');
  expect(await page.locator('body').getAttribute('data-entered')).toBeNull();
 } finally { await page.close(); }
});
it('后台使用可恢复的同一窗口，窗口恢复命令不导航不重载', async () => {
  expect(studyWindowOptions(true)).toEqual({ headless: false, args: [...browserStartupArgs(), '--start-minimized'] });
  const page = await browser.newPage();
  try {
    await page.setContent('<input value="保留当前页面">');
    await setStudyWindow(page, false);
    expect(await page.locator('input').inputValue()).toBe('保留当前页面');
  } finally { await page.close(); }
});

it('内容域空壳随后跳转SSO时不能报告学习页已打开',async()=>{
 const page=await browser.newPage();try{
  await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:new URL(r.request().url()).hostname==='ucontent.unipus.cn' ? `<div id="root"></div><script>setTimeout(()=>location.href='https://sso.unipus.cn/sso/login',150)</script>` : '<input type="password">'}));
  await page.goto('https://ucontent.unipus.cn/_explorationpc_default/pc.html');
  await expect(openUnipusStudy(page,'模拟教程',3000)).rejects.toThrow('需要重新登录');
 }finally{await page.close();}
});
it('短暂 SSO 回调恢复到内容页时不误报重新登录',async()=>{
 const page=await browser.newPage();try{
  await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:new URL(r.request().url()).hostname==='sso.unipus.cn'?`<p>正在恢复会话</p><script>setTimeout(()=>location.href='https://ucontent.unipus.cn/course/#/lesson/1',450)</script>`:'<article class="reading-content">模拟教程正文</article>'}));
  await page.goto('https://sso.unipus.cn/sso/callback');expect(await openUnipusStudy(page,'模拟教程',3000)).toBe(page);
 }finally{await page.close();}
});
