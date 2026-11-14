// Isolated controls and API responses; no real course or model requests.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createServer} from '../apps/local-service/src/server.ts';
import {StudyConfig,STUDY_NOTICE_VERSION,initialStudyStatus} from '../packages/contracts/src/study.ts';
const dir=mkdtempSync(join(tmpdir(),'cw-test-toggle-')),port=17349,token='chapter-test-toggle-fixture-'.repeat(4);
process.env.COURSEWATCH_NATIVE_TOKEN=token;
const server=await createServer({dir,port,test:true});
const platform=server.store.get('platform:chaoxing',{});server.store.set('platform:chaoxing',{...platform,added:true,loginStatus:'logged_in'});
server.engine.rememberCourse('chaoxing',platform.accountId,'course:1:class:2','模拟课程');
const course=server.engine.courses().find(c=>c.platform==='chaoxing');server.engine.selectCourses('chaoxing',platform.accountId,[course.id]);
await server.app.listen({host:'127.0.0.1',port});const browser=await chromium.launch({channel:'chromium',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1060,height:720}});await context.addInitScript(t=>localStorage.setItem('coursewatch-client-token',t),token);
 const page=await context.newPage(),errors=[],starts=[];page.on('pageerror',e=>errors.push(e.message));
 let config={...StudyConfig.parse({enabled:true,noticeVersion:STUDY_NOTICE_VERSION,model:'saved-model',autoSubmitPractice:true}),hasKey:true,active:false};
 let state=initialStudyStatus(),rejectSave=false;
 await page.route('**/api/study/settings',r=>{
  if(r.request().method()==='PATCH'){
   if(rejectSave){rejectSave=false;return r.fulfill({status:409,json:{error:'模拟切换未确认'}});}
   config={...r.request().postDataJSON(),hasKey:true,active:config.active};
  }
  return r.fulfill({json:config});
 });
 await page.route('**/api/study/status',r=>r.fulfill({json:state}));
 await page.route('**/api/study/position?*',r=>r.fulfill({json:{position:null,chapters:[]}}));
 await page.route('**/api/study/start',r=>{
  starts.push(r.request().postDataJSON());config.active=true;state={...initialStudyStatus(),phase:'running',operation:'play',courseName:course.name,message:'正在播放课程'};
  return r.fulfill({json:state});
 });
 await page.goto(`http://127.0.0.1:${port}/?desktop=1`);await page.getByRole('button',{name:'超星学习通',exact:true}).click();
 const study=page.getByRole('region',{name:'学习通自动学习',exact:true});const name='播放时处理章节测试';
 const checkbox=study.getByRole('checkbox',{name,exact:true});await checkbox.waitFor();assert.equal(await checkbox.isChecked(),true);
 await checkbox.uncheck();assert.equal(await study.locator('.study-submit-option').count(),0);
 mkdirSync('docs/screenshots',{recursive:true});
 for(const width of [1060,390,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});await study.locator('.study-test-option').evaluate(el=>el.scrollIntoView({block:'center'}));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await study.locator('.study-test-option').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.screenshot({path:`docs/screenshots/study-test-toggle-start-${width}-${theme}.png`});
 }
 await study.getByRole('button',{name:'后台播放',exact:true}).click();await study.getByText('正在播放课程',{exact:true}).waitFor();
 assert.equal(config.chapterTests,false);assert.equal(config.autoSubmitPractice,true);assert.equal(config.model,'saved-model');assert.equal(starts.length,1);
 await checkbox.check();await study.getByText('章节测试已开启，从后续测试开始处理',{exact:true}).filter({visible:true}).waitFor();assert.equal(config.chapterTests,true);
 rejectSave=true;await checkbox.click();await study.getByText('模拟切换未确认',{exact:true}).filter({visible:true}).waitFor();assert.equal(await checkbox.isChecked(),true);assert.equal(config.chapterTests,true);
 await checkbox.uncheck();await study.getByText('章节测试已关闭，继续播放课程',{exact:true}).filter({visible:true}).waitFor();assert.equal(config.chapterTests,false);assert.equal(starts.length,1);
 for(const width of [1060,390,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});await study.locator('.study-test-option').evaluate(el=>el.scrollIntoView({block:'center'}));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await study.locator('.study-test-option').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.screenshot({path:`docs/screenshots/study-test-toggle-run-${width}-${theme}.png`});
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({startChoiceSaved:true,runningToggle:true,failedToggleRestored:true,noRestart:true,modelPreserved:true,widths:[1060,390,320],themes:['light','dark']}));
}finally{await browser.close();await server.app.close();rmSync(dir,{recursive:true,force:true});}
