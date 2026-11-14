// Isolated fixtures only: no official login, real coursework or model requests.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../apps/local-service/src/server.ts';
import { STUDY_NOTICE_VERSION, UNIPUS_STUDY_NOTICE_VERSION, initialStudyStatus } from '../packages/contracts/src/study.ts';
const dir=mkdtempSync(join(tmpdir(),'cw-console-ui-')),token='console-ui-fixture-'.repeat(5),port=17334;
process.env.COURSEWATCH_NATIVE_TOKEN=token;
const server=await createServer({dir,port,test:true});
for(const id of ['chaoxing','unipus','yuketang'])server.store.set(`platform:${id}`,{...server.store.get(`platform:${id}`,{}),added:true,loginStatus:'logged_in'});
for(let i=1;i<=24;i++)server.engine.rememberCourse('chaoxing',server.store.get('platform:chaoxing',{}).accountId,`course:${i}:class:${100+i}`,i <= 2 ? "模拟同名课程：完整课程名称与同名教学班" : `模拟课程 ${i}：完整课程名称与同名教学班`);
for(let i=1;i<=2;i++)server.engine.rememberCourse('unipus',server.store.get('platform:unipus',{}).accountId,`resource:${i}`,`模拟${i===1?'读写':'视听说'}教程 2`);
server.engine.selectCourses('unipus',server.store.get('platform:unipus',{}).accountId,server.engine.courses().filter(c=>c.platform==='unipus').map(c=>c.id));
server.store.set('studyConfig',{enabled:true,noticeVersion:STUDY_NOTICE_VERSION});
server.store.set('studyConfig:unipus',{enabled:true,noticeVersion:UNIPUS_STUDY_NOTICE_VERSION});
for(const id of ['chaoxing','unipus']) server.store.set(`courseProgress:${id}`,server.engine.courses().filter(c=>c.platform===id).map((c,i)=>({courseId:c.id,name:c.name,completed:i?12:0,total:id==='chaoxing'?70:i?270:276,percent:id==='unipus'?(i?4.5:0):null,chapters:[{name:'模拟第一章',complete:false,pending:2}],observedAt:Date.now()})));
await server.app.listen({host:'127.0.0.1',port});
const browser=await chromium.launch({headless:true,channel:'chromium'}),context=await browser.newContext({viewport:{width:1060,height:720}});
await context.addInitScript(token=>localStorage.setItem('coursewatch-client-token',token),token);
const page=await context.newPage(),errors=[],starts=[];
page.on('pageerror',e=>errors.push(e.message));
const visible=locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;});
const noOverflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'document overflow');
mkdirSync('docs/screenshots',{recursive:true});
try{
 await page.goto(`http://127.0.0.1:${port}/?desktop=1`);
 await page.locator('.course-row').last().waitFor();assert.equal(await page.locator('.course-row').count(),24);
 const save=page.getByRole('button',{name:'保存课程选择',exact:true});
 for(const width of [1060,820,390,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});
  for(const bottom of [false,true]){await page.locator('.sheet-scroll').evaluate((el,b)=>el.scrollTop=b?el.scrollHeight:0,bottom);assert.ok(await visible(save));}
  await noOverflow();await page.screenshot({path:`docs/screenshots/console-courses-${width}-${theme}.png`});
 }
 await page.setViewportSize({width:1060,height:720});await page.locator('.course-row input').first().check();
 let failed=false;await page.route('**/courses/selection',async route=>{if(!failed){failed=true;await route.fulfill({status:500,json:{error:'模拟保存失败'}});}else await route.continue();});
 await save.click();await page.getByText('模拟保存失败',{exact:true}).waitFor();assert.ok(await page.locator('.course-row input').first().isChecked());
 await save.click();await page.locator('.course-manager').waitFor({state:'hidden'});assert.equal(server.engine.courses().filter(c=>c.platform==='chaoxing'&&c.status==='enabled').length,1);
 await page.getByRole('button',{name:'超星学习通',exact:true}).click();
 let panel=page.getByRole('region',{name:'学习通自动学习',exact:true});
 await panel.locator('.study-launch').waitFor();assert.equal(await page.locator('#study-base').count(),0);
 assert.ok(await panel.getByRole('button',{name:'后台播放',exact:true}).isEnabled());
 await page.route('**/api/study/start',async route=>{starts.push(route.request().postDataJSON());await route.fulfill({json:{...initialStudyStatus(),phase:'paused',message:'模拟：需人工处理',closeAt:Date.now()+1800000}});});
 await panel.getByRole('button',{name:'后台播放',exact:true}).click();assert.equal(starts.length,1);assert.equal(starts[0].operation,'play');assert.equal(starts[0].background,true);
 await panel.getByRole('button',{name:'学习设置',exact:true}).click();await page.locator('#study-base').waitFor();assert.equal(await page.locator('#study-base').count(),1);
 assert.ok(!await page.locator('.study-form').first().getByRole('checkbox',{name:/自动填入并提交/}).isChecked());
 for(const width of [1060,820,390,320])for(const theme of ['light','dark']){await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});await page.locator('#study-base').scrollIntoViewIfNeeded();await noOverflow();await page.screenshot({path:`docs/screenshots/console-settings-${width}-${theme}.png`});}
 await page.setViewportSize({width:1060,height:720});await page.getByRole('button',{name:'关闭面板',exact:true}).click();
 await page.route('**/api/study/status',route=>route.fulfill({json:initialStudyStatus()}));await page.reload();await page.getByRole('button',{name:'超星学习通',exact:true}).click();
 panel=page.getByRole('region',{name:'学习通自动学习',exact:true});await panel.locator('.study-launch').waitFor();
 await panel.getByLabel('操作',{exact:true}).selectOption('answers');assert.ok(await panel.getByRole('button',{name:'开始生成答案',exact:true}).isDisabled());
 await panel.getByLabel('操作',{exact:true}).selectOption('keep-open');await panel.locator('.study-launch-options summary').click();assert.equal(await panel.getByRole('spinbutton').inputValue(),'30');
 await panel.getByRole('button',{name:'打开并定时关闭',exact:true}).click();assert.equal(starts.at(-1).operation,'keep-open');assert.equal(starts.at(-1).closeAfterMinutes,30);
 for(const id of ['chaoxing','unipus']){
  await page.getByRole('button',{name:id==='chaoxing'?'超星学习通':'U校园 AI 版',exact:true}).click();
  panel=page.getByRole('region',{name:id==='chaoxing'?'学习通自动学习':'U校园自动学习',exact:true});await page.locator('.course-progress article').first().waitFor();
  assert.equal(await panel.locator('input[type=password]').count(),0);
  for(const width of [1060,820,390,320])for(const theme of ['light','dark']){await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});await panel.evaluate(el=>el.scrollIntoView({block:"start"}));await noOverflow();assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:`docs/screenshots/console-${id}-${width}-${theme}.png`});}
 }
 // One combined save in a native platform window; successful save requests close.
 const popup=await context.newPage();await popup.addInitScript(()=>{window.__nativeActions=[];window.webkit={messageHandlers:{coursewatch:{postMessage:m=>window.__nativeActions.push(m.action)}}};});
 await popup.goto(`http://127.0.0.1:${port}/?desktop=1&platform=chaoxing`);await popup.locator('.course-manager').waitFor();
 assert.equal(await popup.getByRole('button',{name:'保存课程选择',exact:true}).count(),0);assert.equal(await popup.getByRole('button',{name:'保存设置',exact:true}).count(),1);
 assert.ok((await popup.locator('.course-row').first().innerText()).includes('教学班编号'));
 for(const width of [660,480,390,320])for(const theme of ['light','dark']){await popup.setViewportSize({width,height:width===660?700:520});await popup.emulateMedia({colorScheme:theme});await popup.locator('.sheet-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);assert.ok(await visible(popup.getByRole('button',{name:'保存设置',exact:true})));assert.ok(await popup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await popup.screenshot({path:`docs/screenshots/console-platform-${width}-${theme}.png`});}
 await popup.getByRole('button',{name:'保存设置',exact:true}).click();await popup.waitForFunction(()=>window.__nativeActions.includes('closePlatform'));await popup.close();
 // First-open prompt, cancel once per session, persisted after reload, then login suppresses.
 await page.setViewportSize({width:1060,height:720});
 server.store.set('platform:yuketang',{...server.store.get('platform:yuketang',{}),loginStatus:'unknown'});
 await page.reload();await page.getByRole('button',{name:'雨课堂',exact:true}).click();await page.locator('.platform-login-prompt dialog[open]').waitFor();await page.getByRole('button',{name:'稍后登录',exact:true}).click();
 await page.getByRole('button',{name:'全部任务',exact:true}).click();await page.getByRole('button',{name:'雨课堂',exact:true}).click();assert.equal(await page.locator('.platform-login-prompt dialog[open]').count(),0);
 await page.reload();assert.equal(await page.locator('.platform-login-prompt dialog[open]').count(),0);
 await page.getByRole('button',{name:'雨课堂',exact:true}).click();await page.locator('.platform-login-prompt').waitFor();assert.equal(await page.locator('.platform-login-prompt dialog[open]').count(),0);
 await page.setViewportSize({width:320,height:720});await noOverflow();await page.screenshot({path:'docs/screenshots/console-yuketang-login-320.png'});

 // Native prompt starts the login request before opening a separate window.
 const promptPage=await context.newPage();await promptPage.addInitScript(()=>{window.__loginOrder=[];window.webkit={messageHandlers:{coursewatch:{postMessage:m=>{if(m.action==='openPlatform')window.__loginOrder.push('openPlatform');}}}};});
 await promptPage.route('**/api/platforms/yuketang/login',async route=>{await promptPage.evaluate(()=>window.__loginOrder.push('loginRequest'));await route.fulfill({json:{ok:true}});});
 await promptPage.goto(`http://127.0.0.1:${port}/?desktop=1`);await promptPage.getByRole('button',{name:'雨课堂',exact:true}).click();await promptPage.getByRole('button',{name:'打开登录窗口',exact:true}).click();await promptPage.waitForFunction(()=>window.__loginOrder.includes('openPlatform'));assert.deepEqual(await promptPage.evaluate(()=>window.__loginOrder),['loginRequest','openPlatform']);await promptPage.close();
 // Consent dialog: complete copy, fixed confirmation and no implicit acceptance.
 await page.setViewportSize({width:1060,height:720});await page.getByRole('button',{name:'设置',exact:true}).click();
 const toggle=page.getByRole('switch',{name:'U校园自动学习',exact:true});await toggle.click();await page.waitForFunction(()=>document.querySelector('[role=switch][aria-label="U校园自动学习"]')?.getAttribute('aria-checked')==='false');
 for(const width of [1060,820,390,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});await toggle.scrollIntoViewIfNeeded();await toggle.click();
  const notice=page.locator('.study-notice[open]'),accept=notice.getByRole('button',{name:'确认并开启',exact:true});await notice.waitFor();assert.ok(await accept.isDisabled());assert.ok(await visible(accept));assert.equal(await notice.locator('h4').count(),6);assert.ok(await notice.evaluate(el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:`docs/screenshots/console-notice-${width}-${theme}.png`});await notice.getByRole('button',{name:'取消',exact:true}).click();
 }
 await page.getByRole('button',{name:'关闭面板',exact:true}).click();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({courseSaveCloses:true,failurePreservesSelection:true,onePlatformSave:true,modelOnlyInSettings:true,playWithoutKey:true,answersRequireModel:true,startPayloads:starts,firstLoginPrompt:true,widths:[1060,820,660,480,390,320],themes:['light','dark'],errors}));
}finally{await browser.close();await server.app.close();rmSync(dir,{recursive:true,force:true});}
