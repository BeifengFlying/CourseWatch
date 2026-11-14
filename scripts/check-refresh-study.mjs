// Isolated local API and synthetic gestures. No real study tasks are started.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../apps/local-service/src/server.ts';
const dir=mkdtempSync(join(tmpdir(),'cw-refresh-')),token='refresh-fixture-'.repeat(6),port=17338;
process.env.COURSEWATCH_NATIVE_TOKEN=token;
const server=await createServer({dir,port,test:true});
for(const platform of ['chaoxing','unipus']) {
 server.store.set(`platform:${platform}`,{...server.store.get(`platform:${platform}`,{}),added:true,loginStatus:'logged_in'});
 for(let i=1;i<=10;i++) server.engine.rememberCourse(platform,server.store.get(`platform:${platform}`,{}).accountId,platform==='chaoxing'?`course:${i}:class:${i}`:`resource:${i}`,`模拟课程 ${i}：供界面检查使用`);
 server.engine.selectCourses(platform,server.store.get(`platform:${platform}`,{}).accountId,server.engine.courses().filter(c=>c.platform===platform).map(c=>c.id));
}
await server.app.listen({host:'127.0.0.1',port});
const browser=await chromium.launch({headless:true,channel:'chromium'}),context=await browser.newContext({viewport:{width:1060,height:720}});
await context.addInitScript(token=>localStorage.setItem('coursewatch-client-token',token),token);
const page=await context.newPage(),errors=[];let refreshes=0;
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/monitor/check',route=>{refreshes++;return route.fulfill({json:{ok:true}});});
const go=platform=>page.getByRole('button',{name:platform==='chaoxing'?'超星学习通':'U校园 AI 版',exact:true}).click();
const settings=()=>page.getByRole('button',{name:'设置',exact:true}).click();
const close=()=>page.getByRole('button',{name:'关闭面板',exact:true}).click();
const switchFor=platform=>page.getByRole('switch',{name:platform==='chaoxing'?'学习通自动学习':'U校园自动学习',exact:true});
const assistant=()=>page.locator('.study-platform');
mkdirSync('docs/screenshots',{recursive:true});
try {
 await page.goto(`http://127.0.0.1:${port}/?desktop=1`);
 for(const platform of ['chaoxing','unipus']) {
  await go(platform);await page.locator('.course-progress article').first().waitFor();assert.equal(await assistant().count(),0);
  for(const width of [1060,820,390,320])for(const theme of ['light','dark']) {
   await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.ok(await page.locator('.course-progress').evaluate(n=>n.scrollWidth<=n.clientWidth));
   if(platform==='chaoxing'&&[1060,320].includes(width))await page.screenshot({path:`docs/screenshots/refresh-study-off-${width}-${theme}.png`});
  }
  await page.setViewportSize({width:1060,height:720});await settings();await switchFor(platform).click();
  const notice=page.locator('.study-notice[open]');await notice.waitFor();assert.ok(await notice.getByRole('button',{name:'确认并开启'}).isDisabled());
  await notice.getByRole('checkbox').check();await notice.getByRole('button',{name:'确认并开启'}).click();await notice.waitFor({state:'hidden'});await close();await assistant().waitFor();
  for(const width of [1060,320])for(const theme of ['light','dark']) {
   await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});await assistant().scrollIntoViewIfNeeded();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await assistant().evaluate(n=>n.scrollWidth<=n.clientWidth));
   if(platform==='chaoxing')await page.screenshot({path:`docs/screenshots/refresh-study-on-${width}-${theme}.png`});
  }
  await page.setViewportSize({width:1060,height:720});await go(platform==='chaoxing'?'unipus':'chaoxing');await page.locator('.course-progress').waitFor();await assistant().waitFor({state:'hidden'});assert.equal(await assistant().count(),0);
  await go(platform);await assistant().waitFor();await settings();await switchFor(platform).click();await page.waitForFunction(name=>document.querySelector(`[role=switch][aria-label="${name}"]`)?.getAttribute('aria-checked')==='false',platform==='chaoxing'?'学习通自动学习':'U校园自动学习');await close();await assistant().waitFor({state:'hidden'});assert.ok(await page.locator('.course-progress').isVisible());
 }
 // Wheel momentum and nested scrolls never refresh; touch needs sustained movement.
 await page.locator('.glass-workspace').evaluate(n=>n.scrollTop=0);
 await page.locator('.glass-workspace').evaluate(async n=>{for(let i=0;i<20;i++){n.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-120}));await new Promise(r=>setTimeout(r,25));}});
 await page.waitForTimeout(300);assert.equal(refreshes,0);
 const touch=async(selector,points,delay,end='touchend')=>page.locator(selector).first().evaluate(async(n,{points,delay,end})=>{
  const send=(type,y)=>{const touch=new Touch({identifier:1,target:n,clientX:100,clientY:y});n.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'||type==='touchcancel'?[]:[touch],changedTouches:[touch]}));};
  send('touchstart',0);for(const y of points){await new Promise(r=>setTimeout(r,delay));send('touchmove',y);}send(end,points.at(-1));
 },{points,delay,end});
 await touch('.glass-workspace',[320],20);await page.waitForTimeout(250);assert.equal(refreshes,0);
 await touch('.course-progress-list article',[80,160,240,320],100);await page.waitForTimeout(250);assert.equal(refreshes,0);
 await touch('.glass-workspace',[80,160,240,320],100,'touchcancel');await page.waitForTimeout(250);assert.equal(refreshes,0);
 await touch('.glass-workspace',[80,160,240,320],100);await page.waitForFunction(()=>document.body.innerText.includes('检查已完成'));assert.equal(refreshes,1);
 await touch('.glass-workspace',[80,160,240,320],100);assert.equal(refreshes,1);
 // Standard web interface also hides both experimental panels by default.
 await page.goto(`http://127.0.0.1:${port}/`);await page.getByRole('button',{name:'平台管理',exact:true}).click();await page.locator('.course-progress').first().waitFor();assert.equal(await assistant().count(),0);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({studyGating:true,platformIsolation:true,courseQueryRemainsVisible:true,wheelRefreshes:0,shortTouchRefreshes:0,nestedTouchRefreshes:0,cancelledTouchRefreshes:0,deliberateTouchRefreshes:refreshes,widths:[1060,820,390,320],themes:['light','dark'],errors}));
}finally{await browser.close();await server.app.close();rmSync(dir,{recursive:true,force:true});}
