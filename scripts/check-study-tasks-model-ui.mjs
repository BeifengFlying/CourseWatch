// Synthetic task/model output only; no account, platform or model requests.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createServer} from '../apps/local-service/src/server.ts';
import {StudyConfig,STUDY_NOTICE_VERSION,initialStudyStatus} from '../packages/contracts/src/study.ts';
const dir=mkdtempSync(join(tmpdir(),'cw-tasks-model-')),port=17347,token='tasks-model-fixture-'.repeat(5);
process.env.COURSEWATCH_NATIVE_TOKEN=token;
const server=await createServer({dir,port,test:true});
const platform=server.store.get('platform:chaoxing',{});server.store.set('platform:chaoxing',{...platform,added:true,loginStatus:'logged_in'});
server.engine.rememberCourse('chaoxing',platform.accountId,'course:1:class:2','模拟课程：数据结构与算法');
const course=server.engine.courses().find(c=>c.platform==='chaoxing');server.engine.selectCourses('chaoxing',platform.accountId,[course.id]);
await server.app.listen({host:'127.0.0.1',port});
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1060,height:720}});await context.addInitScript(t=>localStorage.setItem('coursewatch-client-token',t),token);
 const page=await context.newPage(),errors=[],actions=[];page.on('pageerror',e=>errors.push(e.message));
 let rejectNextSave=false;
 let config={...StudyConfig.parse({enabled:true,noticeVersion:STUDY_NOTICE_VERSION,model:'fixture-model'}),hasKey:true,active:false};
 const tasks=[{id:'dct1',tabId:'dct1',name:'视频',kind:'video',complete:true,current:false},{id:'dct2',tabId:'dct2',name:'章节检测',kind:'quiz',complete:false,current:true}];
 const chapters=[{id:'1',name:'1.1 线性表的顺序存储结构',complete:false,tasks},{id:'2',name:'1.2 顺序表的插入与删除',complete:true,locked:false},{id:'3',name:'1.3 链表与指针',complete:null,locked:true}];
 let state=initialStudyStatus();
 await page.route('**/api/study/settings',async r=>{if(r.request().method()==='PATCH'){if(rejectNextSave){rejectNextSave=false;return r.fulfill({status:500,json:{error:'模拟保存失败，未启动'}});}config={...r.request().postDataJSON(),hasKey:true,active:config.active};actions.push({save:true});}await r.fulfill({json:config});});
 await page.route('**/api/study/status',r=>r.fulfill({json:state}));
 await page.route('**/api/study/position?*',r=>r.fulfill({json:{position:null,chapters}}));
 await page.route('**/api/study/start',r=>{actions.push(r.request().postDataJSON());config.active=true;state={...initialStudyStatus(),phase:'running',operation:'answers',message:'正在分析第 1／8 题',courseName:course.name,navigation:{previous:false,next:true},progress:{observedAt:Date.now(),course:course.name,chapter:chapters[0].name,chapterId:'1',chapterComplete:false,chapters,media:[],documents:[],tasks},modelActivity:{question:1,total:8,phase:'thinking',reasoning:'模拟接口输出：正在核对选项与题目中的条件。\n此处为界面测试文本。',answer:'',updatedAt:Date.now()}};return r.fulfill({json:state});});
 await page.route('**/api/study/chapter',r=>{actions.push(r.request().postDataJSON());return r.fulfill({json:state});});
 await page.goto(`http://127.0.0.1:${port}/?desktop=1`);await page.getByRole('button',{name:'超星学习通',exact:true}).click();
 const study=page.getByRole('region',{name:'学习通自动学习',exact:true});await study.getByText('视频：已完成 · 章节检测：未完成',{exact:true}).waitFor();
 await study.getByRole('button',{name:'模型与设置',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'选择推理强度',exact:true}).count(),0);
 assert.equal(await page.getByRole('slider',{name:'模型思考强度',exact:true}).count(),0);
 mkdirSync('docs/screenshots',{recursive:true});
 for(const width of [1060,820,390,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});await study.getByRole('button',{name:'保存模型设置',exact:true}).scrollIntoViewIfNeeded();
  assert.ok(await page.locator('.study-model').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.screenshot({path:`docs/screenshots/study-task-model-settings-${width}-${theme}.png`});
 }
 await study.getByRole('button',{name:'保存模型设置',exact:true}).click();await study.getByText('模型设置已保存',{exact:true}).waitFor();
 assert.equal(Object.hasOwn(config,'reasoningEffort'),false);await study.getByLabel('模型名称',{exact:true}).fill('unsaved-model-draft');await study.getByRole('button',{name:'关闭模型设置',exact:true}).click();
 const autoSubmit=study.locator('.study-submit-option input');assert.equal(await autoSubmit.isChecked(),false);
 await autoSubmit.check();rejectNextSave=true;
 await study.getByRole('button',{name:'做章节检测：'+chapters[0].name,exact:true}).click();
 await study.getByText('模拟保存失败，未启动',{exact:true}).filter({visible:true}).waitFor();assert.equal(config.active,false);assert.ok(!actions.some(a=>a.operation==='answers'));
 await study.getByRole('button',{name:'做章节检测：'+chapters[0].name,exact:true}).click();
 await study.getByRole('region',{name:'模型实时输出',exact:true}).waitFor();
 assert.equal(config.autoSubmitPractice,true);assert.equal(config.model,'fixture-model');assert.equal(actions.at(-2).save,true);
 assert.ok(actions.some(a=>a.operation==='answers'&&a.task==='quiz'&&a.chapterId==='1'&&a.courseId===course.id));
 for(const width of [1060,820,390,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});
  const output=study.getByRole('region',{name:'模型实时输出',exact:true});await output.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await output.evaluate(el=>el.scrollWidth<=el.clientWidth));
  assert.ok(await study.locator('.study-directory').evaluate(el=>el.scrollWidth<=el.clientWidth));
  const directory=study.locator('.study-directory');
  assert.equal(await directory.locator('.study-complete-icon').count(),2,'仅已完成小节和视频显示勾');
  const expected=theme==='dark'?'rgb(112, 213, 139)':'rgb(35, 122, 59)';
  assert.equal(await directory.locator('.study-complete-icon').first().evaluate(el=>getComputedStyle(el).color),expected);
  assert.equal(await directory.getByRole('button',{name:/1.3 链表/}).locator('.study-complete-icon').count(),0);
  await page.screenshot({path:`docs/screenshots/study-task-model-run-${width}-${theme}.png`});
  if(width===1060){
   await page.setViewportSize({width:1060,height:1400});
   await study.evaluate(el=>el.scrollIntoView({block:'start'}));
   await page.locator('.glass-workspace').evaluate(el=>el.scrollTop=Math.max(0,el.scrollTop-90));
   await directory.screenshot({path:`docs/screenshots/completed-tasks-${theme}.png`});
   await page.setViewportSize({width:1060,height:720});
  }
 }
 state.modelActivity.phase='answering';state.modelActivity.answer='{"answers":["2"],"explanation":"模拟答案输出"}';
 await study.getByText(state.modelActivity.answer,{exact:true}).waitFor({timeout:6000});
 state.modelActivity.phase='completed';state.modelActivity.reasoning='';
 await study.getByText('接口未返回可展示的思考内容。',{exact:true}).waitFor();
 assert.equal(await study.getByRole('button',{name:'选择推理强度'}).count(),0);
 await study.getByRole('button',{name:'进入章节检测：'+chapters[0].name,exact:true}).click();assert.deepEqual(actions.at(-1),{chapterId:'1',task:'quiz'});
 await page.setViewportSize({width:820,height:600});await page.emulateMedia({reducedMotion:'reduce',contrast:'more'});assert.ok(await study.locator('.study-run').evaluate(el=>el.scrollWidth<=el.clientWidth));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({autoSubmitSavedBeforeStart:true,failedSaveBlocksStart:true,effortControlRemoved:true,directQuiz:true,separateTaskStates:true,liveOutput:true,noFabricatedReasoning:true,navigation:true,widths:[1060,820,390,320],themes:['light','dark']}));
}finally{await browser.close();await server.app.close();rmSync(dir,{recursive:true,force:true});}
