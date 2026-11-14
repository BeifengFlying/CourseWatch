// Isolated UI fixture. No official playback or account writes.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createServer} from '../apps/local-service/src/server.ts';
import {STUDY_NOTICE_VERSION,initialStudyStatus} from '../packages/contracts/src/study.ts';
const dir=mkdtempSync(join(tmpdir(),'cw-playback-')),port=17340,token='playback-fixture-'.repeat(6);
process.env.COURSEWATCH_NATIVE_TOKEN=token;
const server=await createServer({dir,port,test:true});const saved=server.store.get('platform:chaoxing',{});server.store.set('platform:chaoxing',{...saved,added:true,loginStatus:'logged_in'});
server.engine.rememberCourse('chaoxing',saved.accountId,'course:1:class:2','模拟数据结构：线性结构与算法');server.engine.selectCourses('chaoxing',saved.accountId,server.engine.courses().filter(c=>c.platform==='chaoxing').map(c=>c.id));
server.store.set('studyConfig',{enabled:true,noticeVersion:STUDY_NOTICE_VERSION});
await server.app.listen({host:'127.0.0.1',port});
const browser=await chromium.launch({headless:true,channel:'chromium'}),context=await browser.newContext({viewport:{width:1060,height:720}});await context.addInitScript(t=>localStorage.setItem('coursewatch-client-token',t),token);
const page=await context.newPage(),errors=[],actions=[];page.on('pageerror',e=>errors.push(e.message));
let state={...initialStudyStatus(),phase:'running',courseName:'模拟数据结构：线性结构与算法',operation:'play',message:'正在播放当前章节',navigation:{previous:false,next:true},progress:{course:'模拟数据结构',chapter:'第二章 · 线性表的顺序存储结构与操作',chapterComplete:null,media:[{kind:'video',current:132,duration:600,paused:false,ended:false}],documents:[],chapters:[],observedAt:Date.now()}};
await page.route('**/api/study/settings',r=>r.fulfill({json:{enabled:true,noticeVersion:STUDY_NOTICE_VERSION,active:['starting','running','paused'].includes(state.phase),hasKey:false}}));
await page.route('**/api/study/status',r=>r.fulfill({json:state}));
await page.route('**/api/study/show', r => { actions.push('show'); return r.fulfill({json:{ok:true}}); });
for(const action of ['pause','resume','previous','next'])await page.route(`**/api/study/${action}`,async r=>{
 actions.push(action);
 if(action==='pause'||action==='resume'){state.phase=action==='pause'?'paused':'running';state.progress.media[0].paused=action==='pause';}else{state.progress.chapter=action==='next'?'第三章 · 栈和队列':'第二章 · 线性表';state.progress.media[0].current=0;state.navigation={previous:true,next:action!=='next'};}
 await r.fulfill({json:state});
});
mkdirSync('docs/screenshots',{recursive:true});
try{
 await page.goto(`http://127.0.0.1:${port}/?desktop=1`);await page.getByRole('button',{name:'超星学习通',exact:true}).click();const panel=page.locator('.study-run');await panel.waitFor();
 assert.ok(await page.locator('.study-platform').evaluate(el=>Boolean(el.compareDocumentPosition(document.querySelector('.course-progress-panel')) & Node.DOCUMENT_POSITION_FOLLOWING)));
 const controls=panel.locator('.study-transport');assert.ok(await controls.getByRole('button',{name:'上一节',exact:true}).isDisabled());
 assert.equal(await panel.getByRole('progressbar').getAttribute('value'),'22');
 await controls.getByRole('button',{name:'暂停',exact:true}).click();await controls.getByRole('button',{name:'继续',exact:true}).waitFor();assert.equal(state.phase,'paused');
 await controls.getByRole('button',{name:'下一节',exact:true}).click();await panel.getByText('第三章 · 栈和队列',{exact:true}).waitFor();assert.equal(state.phase,'paused');assert.ok(await controls.getByRole('button',{name:'下一节',exact:true}).isDisabled());
 await controls.getByRole('button',{name:'上一节',exact:true}).click();await panel.getByText('第二章 · 线性表',{exact:true}).waitFor();
 await controls.getByRole('button',{name:'继续',exact:true}).click();await controls.getByRole('button',{name:'暂停',exact:true}).waitFor();
 state.progress.media[0].current=180;await page.waitForFunction(()=>document.querySelector('.study-media progress')?.value===30,{},{timeout:5000});
 for(const width of [1060,820,390,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});await panel.evaluate(el=>el.scrollIntoView({block:'start'}));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth));
  assert.ok(await controls.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));await page.screenshot({path:`docs/screenshots/study-playback-${width}-${theme}.png`});
  assert.equal(await controls.locator('.study-play').evaluate(el=>getComputedStyle(el).borderRadius),'12px');
  assert.ok(await controls.locator('.study-play').evaluate(el=>el.getBoundingClientRect().height>=44));
 }
 state.progress.media=[{kind:'audio',current:0,duration:null,paused:true,ended:false}];state.phase='paused';await panel.getByText('0:00 / 总时长未知',{exact:true}).waitFor();assert.equal(await panel.getByRole('progressbar').count(),0);
 await panel.getByRole('button',{name:'打开运行窗口',exact:true}).click();assert.deepEqual(actions,['pause','next','previous','resume','show']);
 assert.equal(await panel.locator('.study-run-details').getAttribute('open'),null);
 await panel.locator('.study-run-details > summary').click();
 const downloadPromise=page.waitForEvent('download');await panel.getByRole('button',{name:'导出系统日志',exact:true}).click();
 const download=await downloadPromise;await download.saveAs(join(dir,'export.json'));const exported=JSON.parse(readFileSync(join(dir,'export.json'),'utf8'));
 assert.equal(download.suggestedFilename(),'coursewatch-system-logs.json');assert.equal(exported.schemaVersion,1);assert.ok(!JSON.stringify(exported).includes(token));
 state.phase='failed';state.message='模拟：官网课程未加载，请导出系统日志';
 await page.locator('.study-run[data-phase=failed]').waitFor();assert.equal(await panel.getByRole('button',{name:'打开运行窗口',exact:true}).count(),0);assert.ok(await panel.getByRole('button',{name:'导出系统日志',exact:true}).isEnabled());
 for(const width of [1060,820,390,320])for(const theme of ['light','dark']){await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});await panel.evaluate(el=>el.scrollIntoView({block:'start'}));assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:`docs/screenshots/study-failure-${width}-${theme}.png`});}
 await page.setViewportSize({width:820,height:600});await page.emulateMedia({reducedMotion:'reduce',contrast:'more'});await panel.evaluate(el=>el.scrollIntoView({block:'start'}));assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({controls:actions,polling:true,unknownDuration:true,progressBeforeCourses:true,diagnosticDownload:true,failureExport:true,collapsedDetails:true,widths:[1060,820,390,320],themes:['light','dark']}));
}finally{await browser.close();await server.app.close();rmSync(dir,{recursive:true,force:true});}
