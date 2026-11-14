// UI fixture: chapter selection/resume only. No official course or model requests.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createServer} from '../apps/local-service/src/server.ts';
import {STUDY_NOTICE_VERSION,UNIPUS_STUDY_NOTICE_VERSION,initialStudyStatus} from '../packages/contracts/src/study.ts';
const dir=mkdtempSync(join(tmpdir(),'cw-chapters-')),port=17345,token='chapters-fixture-'.repeat(5);
process.env.COURSEWATCH_NATIVE_TOKEN=token;
const server=await createServer({dir,port,test:true});
for(const platform of ['chaoxing','unipus']){
 const saved=server.store.get(`platform:${platform}`,{});server.store.set(`platform:${platform}`,{...saved,added:true,loginStatus:'logged_in'});
 server.engine.rememberCourse(platform,saved.accountId,platform==='chaoxing'?'course:1:class:2':'resource:1','模拟课程：章节选择与位置记忆');
 server.engine.selectCourses(platform,saved.accountId,server.engine.courses().filter(c=>c.platform===platform).map(c=>c.id));
 server.store.set(platform==='chaoxing'?'studyConfig':'studyConfig:unipus',{enabled:true,noticeVersion:platform==='chaoxing'?STUDY_NOTICE_VERSION:UNIPUS_STUDY_NOTICE_VERSION});
}
await server.app.listen({host:'127.0.0.1',port});
const browser=await chromium.launch({headless:true,channel:'chromium'});mkdirSync('docs/screenshots',{recursive:true});
try{
 for(const platform of ['chaoxing','unipus']){
  const context=await browser.newContext({viewport:{width:1060,height:720}});await context.addInitScript(t=>localStorage.setItem('coursewatch-client-token',t),token);
  const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
  const prefix=platform==='chaoxing'?'study':'study/unipus',version=platform==='chaoxing'?STUDY_NOTICE_VERSION:UNIPUS_STUDY_NOTICE_VERSION;
  let state=initialStudyStatus();
  const chapters=[{id:'1',name:'第一章 · 视频',complete:true,locked:false},{id:'2',name:'第二章 · 章节检测后的继续学习位置',complete:null,locked:false},{id:'3',name:'第三章 · 待开放',complete:null,locked:true}];
  const hierarchy=[{id:'unit-1',name:'第一单元 · 课程内容'}];
  await page.route(`**/api/${prefix}/settings`,r=>r.fulfill({json:{enabled:true,noticeVersion:version,active:['starting','running','paused'].includes(state.phase),hasKey:false}}));
  await page.route(`**/api/${prefix}/status`,r=>r.fulfill({json:state}));
  chapters.forEach(c=>c.path=hierarchy);
  await page.route(`**/api/${prefix}/position?*`,r=>r.fulfill({json:{position:{chapterId:'2',chapter:chapters[1].name,tabId:'dct2',observedAt:100},chapters}}));
  await page.route(`**/api/${prefix}/start`,r=>{requests.push(r.request().postDataJSON());state={...initialStudyStatus(),phase:'paused',courseName:'模拟课程',message:'已暂停',navigation:{previous:true,next:false},progress:{course:'模拟课程',chapter:chapters[1].name,chapterId:'2',chapterComplete:null,media:[],documents:[],chapters,observedAt:Date.now()}};return r.fulfill({json:state});});
  await page.route(`**/api/${prefix}/chapter`,r=>{requests.push(r.request().postDataJSON());state.progress.chapter=chapters[0].name;state.progress.chapterId='1';return r.fulfill({json:state});});
  await page.goto(`http://127.0.0.1:${port}/?desktop=1`);await page.getByRole('button',{name:platform==='chaoxing'?'超星学习通':'U校园 AI 版',exact:true}).click();
  const start=page.getByRole('region',{name:platform==='chaoxing'?'学习通自动学习':'U校园自动学习',exact:true});await start.waitFor();
  if(platform==='unipus')await start.getByRole('radio',{name:'播放课程',exact:true}).check();
  await start.getByText('继续上次位置 · '+chapters[1].name,{exact:true}).waitFor();
  const group=start.getByRole('button',{name:/第一单元.*小节/});
  await group.click();assert.equal(await start.getByRole('button',{name:/第一章.*已完成/}).count(),0);
  await group.click();assert.equal(await group.getAttribute('aria-expanded'),'true');
  assert.equal(await start.getByRole('button',{name:/第三章.*未开放/}).isDisabled(),true);
  for(const width of [1060,820,390,320])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});await start.evaluate(el=>el.scrollIntoView({block:'center'}));
   const cards=await page.locator('.study-workspace').evaluate(el=>({columns:getComputedStyle(el).gridTemplateColumns.split(' ').length,boxes:[...el.querySelectorAll(':scope>.study-launch,:scope>.study-directory')].map(n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};})}));
   if(cards.columns===2){const [a,b]=cards.boxes;assert.ok(Math.abs(a.y-b.y)<1,'卡片顶部对齐');assert.ok(a.width>b.width,'学习卡片比目录宽');assert.ok(Math.abs(a.height-b.height)<2,'两卡片底部对齐');}
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`docs/screenshots/study-chapters-start-${platform}-${width}-${theme}.png`});
  }
  await start.getByRole('button',{name:/第一章.*已完成/}).click();await page.locator('.study-launch button[type=submit]').click();assert.equal(requests[0].chapterId,'1');
  const choose=page.getByRole('complementary',{name:'学习章节'});await choose.waitFor();assert.equal(await choose.getByRole('button',{name:/第三章.*未开放/}).isDisabled(),true);
  await choose.getByRole('button',{name:/第一章.*已完成/}).click();assert.deepEqual(requests[1],{chapterId:'1'});assert.equal(state.phase,'paused');
  for(const width of [1060,820,390,320])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});await choose.evaluate(el=>el.scrollIntoView({block:'center'}));
   const cards=await page.locator('.study-workspace').evaluate(el=>({columns:getComputedStyle(el).gridTemplateColumns.split(' ').length,boxes:[...el.querySelectorAll(':scope>.study-run,:scope>.study-directory')].map(n=>{const b=n.getBoundingClientRect();return {y:b.y,width:b.width,height:b.height};})}));
   if(cards.columns===2){const [a,b]=cards.boxes;assert.ok(Math.abs(a.y-b.y)<1,'运行卡片顶部对齐');assert.ok(a.width>b.width,'运行卡片比目录宽');assert.ok(Math.abs(a.height-b.height)<2,'运行卡片和目录底部对齐');}
   assert.ok(await page.locator('.study-run').evaluate(el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:`docs/screenshots/study-chapters-run-${platform}-${width}-${theme}.png`});
  }
  chapters.push({id:'nested',name:'第一章的小节 · 阅读',complete:false,locked:false,path:[...hierarchy,{id:'1',name:chapters[0].name}]});
  await page.waitForFunction(()=>[...document.querySelectorAll('.chapter-label')].some(el=>el.textContent.includes('第一章的小节')));
  const nestedToggle=choose.getByRole('button',{name:'收起'+chapters[0].name+'的小节',exact:true});
  await nestedToggle.click();assert.equal(await choose.getByRole('button',{name:/第一章的小节 · 阅读.*未完成/}).count(),0);
  await choose.getByRole('button',{name:'展开'+chapters[0].name+'的小节',exact:true}).click();
  await choose.getByRole('button',{name:/第一章的小节 · 阅读.*未完成/}).waitFor();
  chapters.push(...Array.from({length:36},(_,i)=>({id:'extra-'+i,name:'模拟目录第 '+(i+4)+' 节',complete:false,locked:false})));
  await page.setViewportSize({width:1060,height:720});
  await page.waitForFunction(()=>document.querySelectorAll('.chapter-list li').length > 30);
  const list=page.locator('.chapter-list ol'),outer=page.locator('.glass-workspace');
  await list.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await list.evaluate(el=>el.scrollTop=el.scrollHeight);await page.waitForTimeout(100);
  const before=await outer.evaluate(el=>el.scrollTop),bounds=await list.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,Math.min(bounds.y+bounds.height/2,680));
  await page.mouse.wheel(0,180);await page.waitForTimeout(350);
  await page.mouse.wheel(0,180);await page.waitForTimeout(250);
  assert.ok(await outer.evaluate((el,before)=>el.scrollTop > before,before),'章节列表到底后应继续滚动主窗口');
  await list.scrollIntoViewIfNeeded();await list.evaluate(el=>el.scrollTop=0);
  const beforeUp=await outer.evaluate(el=>el.scrollTop),upBounds=await list.boundingBox();
  await page.mouse.move(upBounds.x+upBounds.width/2,Math.max(90,upBounds.y+30));
  await page.mouse.wheel(0,-180);await page.waitForTimeout(250);
  assert.ok(await outer.evaluate((el,before)=>el.scrollTop < before,beforeUp),'章节列表到顶后应向上滚动主窗口');
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log(JSON.stringify({platforms:['chaoxing','unipus'],resume:true,hierarchyDisclosure:true,alignedCards:true,explicitStart:true,pausedJump:true,lockedDisabled:true,widths:[1060,820,390,320],themes:['light','dark']}));
}finally{await browser.close();await server.app.close();rmSync(dir,{recursive:true,force:true});}
