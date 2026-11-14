import { afterEach, expect, it } from 'vitest';
import { chromium, type Browser, type LaunchOptions } from 'playwright';
import { UnipusWindow, unipusWindowOptions } from '../packages/study/src/unipus-window.js';
import { keepUnipusActive, releaseUnipusActivity } from '../packages/study/src/unipus-activity.js';

const browsers: Browser[] = [];
const launches: LaunchOptions[] = [];
const origin = 'https://ucontent.unipus.cn';
const fixture = '<div class="reading-content">阅读内容</div>';
async function launch(options: LaunchOptions) {
  launches.push(options);
  // Explicit foreground requests are recorded but rendered headlessly in tests.
  const browser = await chromium.launch({ ...options, channel: 'chromium', headless: true });
  browsers.push(browser);
  const create = browser.newContext.bind(browser);
  browser.newContext = async options => {
    const context = await create(options);
    await context.route('**/*', route => route.fulfill({contentType:'text/html',body:fixture}));
    return context;
  };
  return browser;
}
afterEach(async () => { await Promise.all(browsers.splice(0).map(b=>b.close())); launches.length = 0; });

it('后台启动没有原生窗口参数，页面请求 focus 和 popup 后保活仍只使用原浏览器', async () => {
  expect(unipusWindowOptions(true).headless).toBe(true);
  expect(unipusWindowOptions(true).args).not.toContain('--start-minimized');
  const session = new UnipusWindow({}, true, launch);
  await session.start({cookies:[],origins:[]});
  const page = await session.context!.newPage(); await page.goto(origin+'/course/#/reading');
  expect(await page.evaluate(()=>navigator.userAgent)).toContain('HeadlessChrome');
  await page.evaluate(() => {
    document.addEventListener('mousemove',()=>{window.focus();window.open('/course/#/popup','keepalive-popup');});
  });
  expect(await keepUnipusActive(page,undefined,0)).toBe(true);
  expect(await keepUnipusActive(page,undefined,299999)).toBe(false);
  expect(await keepUnipusActive(page,undefined,300000)).toBe(true);
  expect(launches).toHaveLength(1); expect(launches[0].headless).toBe(true);
  await releaseUnipusActivity(page);
});

it('只有显式切换才请求前台浏览器，继续时转回后台并保留会话及官网地址', async () => {
  const session = new UnipusWindow({}, true, launch);
  await session.start({cookies:[],origins:[]});
  const page = await session.context!.newPage(); await page.goto(origin+'/course/#/reading');
  await page.evaluate(()=>{localStorage.setItem('fixture-local','one');sessionStorage.setItem('fixture-session','two');});
  await session.context!.addCookies([{name:'fixture',value:'three',url:origin}]);
  const old = session.browser!;
  await session.switchMode(false,new AbortController().signal);
  expect(old.isConnected()).toBe(false); expect(session.background).toBe(false);
  let restored = session.context!.pages()[0];
  expect(restored.url()).toBe(origin+'/course/#/reading');
  expect(await restored.evaluate(()=>[localStorage.getItem('fixture-local'),sessionStorage.getItem('fixture-session')])).toEqual(['one','two']);
  expect((await session.context!.cookies())[0].value).toBe('three');
  await restored.evaluate(()=>sessionStorage.setItem('fixture-session','changed'));
  await session.switchMode(true,new AbortController().signal);
  restored = session.context!.pages()[0];
  expect(await restored.evaluate(()=>sessionStorage.getItem('fixture-session'))).toBe('changed');
  expect(session.background).toBe(true);
  expect(launches.map(options=>options.headless)).toEqual([true,false,true]);
});

it('已取消的打开请求不启动前台浏览器，启动失败保留原后台页面', async () => {
  let fail = false;
  const session = new UnipusWindow({},true,async options=>{if(fail)throw new Error('fixture-launch-failed');return launch(options);});
  await session.start({cookies:[],origins:[]});
  const page = await session.context!.newPage(); await page.goto(origin+'/course/#/reading');
  const controller = new AbortController(); controller.abort();
  await expect(session.switchMode(false,controller.signal)).rejects.toThrow();
  expect(launches).toHaveLength(1);
  fail=true;
  await expect(session.switchMode(false,new AbortController().signal)).rejects.toThrow('fixture-launch-failed');
  expect(session.background).toBe(true);expect(page.isClosed()).toBe(false);
});
