import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { Adapters } from '../packages/adapters/src/index.js';
import { reportBrowserFailure, watchBrowserDiagnostics } from '../packages/adapters/src/browser-diagnostics.js';
import { DiagnosticLog, diagnosticErrorFacts, diagnosticLocation } from '../packages/core/src/diagnostics.js';

let browser: Browser, dir: string;
beforeAll(async () => { browser = await chromium.launch({channel:'chromium',headless:true}); });
afterAll(async () => { await browser.close(); });
beforeEach(() => { dir = mkdtempSync(join(tmpdir(),'cw-browser-diagnostics-')); });
afterEach(() => { rmSync(dir,{recursive:true,force:true}); });

it.each([
  [401,'{}','auth_required',undefined],
  [403,'{}','verification_required',undefined],
  [200,'{"code":3009,"msg":"token private-secret 已过期"}','auth_required',3009],
  [200,'{"code":6001,"msg":"private-secret 请验证"}','verification_required',6001],
] as const)('登录确认失败保留 HTTP %s、平台错误码和读取阶段', async (status,body,outcome,applicationCode) => {
  const get = vi.fn(async () => ({status:()=>status,ok:()=>status===200,
    url:()=> 'https://uai.unipus.cn/api/cmgt/course/my/bookshelf?token=private-secret',headers:()=>({}),text:async()=>body,dispose:async()=>{}}));
  const context = {request:{get},pages:()=>[],storageState:async()=>({origins:[{origin:'https://uai.unipus.cn',localStorage:[{name:'PORTAL_STATE_PERSISTENT',value:'{"tokenInfo":{"jwt":"private-secret"}}'}]}]})} as unknown as BrowserContext;
  const adapters = new Adapters(dir);
  (adapters as any).active = {platform:'unipus',context};
  await expect(adapters.finish('unipus')).rejects.toThrow(/登录|验证/);
  expect(adapters.activeLogin).toBe('unipus');
  const exported = new DiagnosticLog(dir).read();
  const failure = exported.entries.find(e=>e.event==='operation-failed');
  expect(failure).toMatchObject({source:'unipus',stage:'login-confirm',facts:{failureStage:'login-confirm',status,outcome,endpoint:'/api/cmgt/course/my/bookshelf',method:'GET'}});
  expect(failure?.facts?.durationMs).toBeTypeOf('number');
  if(applicationCode) expect(failure?.facts?.applicationCode).toBe(applicationCode);
  expect(JSON.stringify(exported)).not.toContain('private-secret');
});

it('导出网络错误和接口模板，剔除 URL 参数、动态路径及原始堆栈', () => {
  expect(diagnosticErrorFacts(new Error('apiRequestContext.get: net::ERR_NAME_NOT_RESOLVED https://private-secret.test/?token=private-secret'))).toEqual({errorType:'Error',operation:'apiRequestContext.get',networkError:'ERR_NAME_NOT_RESOLVED'});
  expect(diagnosticLocation('https://uai.unipus.cn/app/cmgt/resource-detail/private-secret?jwt=private-secret#private-secret')).toEqual({host:'uai.unipus.cn',endpoint:'/app/cmgt/resource-detail/:id'});
  expect(diagnosticLocation('https://uai.unipus.cn/private-secret')).toEqual({host:'uai.unipus.cn',endpoint:'other'});
});

it('页面失败日志记录登录、验证与目录控件数量，网络失败含方法和错误码', async () => {
  const context = await browser.newContext();
  const log = new DiagnosticLog(dir);
  const report = (event:string,stage:string,reason?:string,facts?:Record<string,string|number|boolean|null>) => log.record('unipus',event,{stage,reason,facts});
  watchBrowserDiagnostics(context,report);
  try {
    await context.route('**/*',route=>route.request().url().includes('/failed') ? route.abort('namenotresolved') : route.fulfill({contentType:'text/html; charset=utf-8',body:'<p>private-secret</p><input type="password" value="private-secret"><div data-captcha>private-secret</div><div role="dialog">private-secret</div><aside class="pc-slider-content-menu"><div class="pc-slider-menu-micro">private-secret</div></aside><script>fetch("/failed?token=private-secret").catch(()=>{})</script>'}));
    const page = await context.newPage();
    const failed = page.waitForEvent('requestfailed');
    await page.goto('https://ucontent.unipus.cn/course/private-secret?jwt=private-secret');
    await failed;
    await reportBrowserFailure(new Error('Timeout 5000ms exceeded private-secret'),'catalog',page,report);
    const exported = log.read();
    expect(exported.entries.find(e=>e.event==='page-state')).toMatchObject({facts:{endpoint:'/course/*',passwordFields:1,verificationControls:1,dialogs:1,chapterNodes:1,visibleChapterNodes:1,topFrame:true}});
    expect(exported.entries.find(e=>e.event==='request-failed')).toMatchObject({reason:'dns',facts:{networkError:'ERR_NAME_NOT_RESOLVED',method:'GET',type:'fetch'}});
    expect(JSON.stringify(exported)).not.toContain('private-secret');
  } finally { await context.close(); }
});

it('开发进程通过 tsx 读取章节和页面诊断时，浏览器回调不依赖 Node 转译辅助函数', async () => {
  const script = `
    import {chromium} from 'playwright';
    import {frameChapters} from './packages/study/src/chapter-directory.ts';
    import {reportBrowserFailure} from './packages/adapters/src/browser-diagnostics.ts';
    const browser=await chromium.launch({channel:'chromium',headless:true});
    try {
      const page=await browser.newPage();
      await page.setContent('<aside class="pc-slider-content-menu"><div class="pc-slider-menu-micro" data-completed="true">Reading</div></aside>');
      const chapters=await frameChapters(page.mainFrame(),'unipus');
      let nodes=null;
      await reportBrowserFailure(new Error('fixture'),'catalog',page,(event,stage,reason,facts)=>{if(event==='page-state')nodes=facts.chapterNodes;});
      console.log(JSON.stringify({chapters:chapters.length,complete:chapters[0].complete,nodes}));
    } finally {await browser.close();}
  `;
  const {stdout} = await promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','--eval',script],{cwd:process.cwd(),timeout:15000});
  expect(JSON.parse(stdout)).toEqual({chapters:1,complete:true,nodes:1});
},20000);
