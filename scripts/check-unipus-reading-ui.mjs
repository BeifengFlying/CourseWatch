// Isolated UI fixture; no accounts, official pages, model calls or OS settings.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createServer} from '../apps/local-service/src/server.ts';
import {initialStudyStatus,StudyConfig,UNIPUS_STUDY_NOTICE_VERSION} from '../packages/contracts/src/study.ts';
const dir=mkdtempSync(join(tmpdir(),'cw-unipus-reading-')),port=17412,token='unipus-reading-fixture-'.repeat(5);
process.env.COURSEWATCH_NATIVE_TOKEN=token;
const server=await createServer({dir,port,test:true});
const saved=server.store.get('platform:unipus',{});
server.store.set('platform:unipus',{...saved,added:true,loginStatus:'logged_in'});
const course=server.engine.rememberCourse('unipus',saved.accountId,'resource:fixture','模拟大学英语教程');
server.engine.selectCourses('unipus',saved.accountId,[course.id]);
server.store.set('studyConfig:unipus',StudyConfig.parse({enabled:true,noticeVersion:UNIPUS_STUDY_NOTICE_VERSION}));
const chapters=Array.from({length:18},(_,i)=>({id:String(i),name:i%3===0?'Reading the text · 课程正文与练习':i%3===1?'Language focus':'Reading comprehension',complete:i===0,locked:i===5,required:i%3===0?true:i%3===1?false:null,path:[{id:'unit'+Math.floor(i/3),name:`Unit ${Math.floor(i/3)+1} · Campus life`},{id:'section'+Math.floor(i/3),name:'Section A · 读写内容'}]}));
const state={...initialStudyStatus(),phase:'paused',message:'模拟：已暂停',courseName:course.name,operation:'answers',navigation:{previous:true,next:true},progress:{course:course.name,chapter:chapters[1].name,chapterId:'1',chapterComplete:false,chapters,media:[],documents:[],observedAt:Date.now()}};
await server.app.listen({host:'127.0.0.1',port});
const browser=await chromium.launch({channel:'chromium',headless:true});
const output='docs/screenshots/unipus-reading-2026-11-16';mkdirSync(output,{recursive:true});
try{
 for(const native of [false,true]){
  const context=await browser.newContext({viewport:{width:1060,height:800}});
  await context.addInitScript(({token,native})=>{
   localStorage.setItem('coursewatch-client-token',token);
   if(native){window.webkit={messageHandlers:{coursewatch:{postMessage(){}}}};document.addEventListener('DOMContentLoaded',()=>document.documentElement.dataset.native='true',{once:true});}
  },{token,native});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/study/unipus/status',r=>r.fulfill({json:state}));
  await page.route('**/api/study/unipus/catalog',r=>r.fulfill({json:{items:[{courseId:course.id,name:course.name,completed:1,total:18,percent:null,chapters,observedAt:Date.now()}],issues:[]}}));
  await page.route('**/api/study/unipus/settings',r=>r.fulfill({json:{...StudyConfig.parse({enabled:true,noticeVersion:UNIPUS_STUDY_NOTICE_VERSION}),active:true,hasKey:false}}));
  await page.goto(`http://127.0.0.1:${port}/?desktop=1`);
  await page.getByRole('button',{name:'U校园 AI 版',exact:true}).click();
  const list=page.locator('.chapter-list');await list.getByText('必修',{exact:true}).first().waitFor();
  assert.equal(await list.getByText('非必修',{exact:true}).count(),6);
  assert.equal(await list.getByText('必修属性待确认',{exact:true}).count(),6);
  for(const width of [1060,820,390,320])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:800});await page.emulateMedia({colorScheme:theme});
   await list.scrollIntoViewIfNeeded();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'document overflow');
   assert.ok(await list.evaluate(el=>el.scrollWidth<=el.clientWidth),'chapter overflow');
   const icon=await page.locator('.rail-top img').boundingBox();
   if(native)assert.ok(icon.y>=64,`macOS titlebar overlaps icon at ${width}: ${icon.y}`);
   assert.ok(await list.getByRole('button',{name:/Unit 1.*小节/}).isVisible());
   await page.screenshot({path:`${output}/${native?'macos-bridge':'browser'}-${width}-${theme}.png`});
  }
  await page.setViewportSize({width:1060,height:800});
  await list.getByRole('searchbox').fill('非必修');
  assert.equal(await list.getByText('必修',{exact:true}).count(),0);
  assert.equal(await list.getByText('非必修',{exact:true}).count(),6);
  await list.getByRole('searchbox').fill('Unit 2');
  assert.equal(await list.getByText('非必修',{exact:true}).count(),1);
  await page.getByText('全部课程进度',{exact:true}).click();
  const catalog=page.locator('.course-progress');
  await catalog.getByText('章节目录（18）',{exact:true}).click();
  assert.equal(await catalog.locator('li').filter({hasText:'非必修'}).count(),6);
  assert.equal(await catalog.getByText('Unit 1 · Campus life / Section A · 读写内容',{exact:true}).count(),3);
  for(const width of [1060,820,390,320])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:800});await page.emulateMedia({colorScheme:theme});
   await catalog.scrollIntoViewIfNeeded();
   assert.ok(await catalog.evaluate(el=>el.scrollWidth<=el.clientWidth),'catalog overflow');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'document overflow with catalog');
   if([1060,320].includes(width))await page.screenshot({path:`${output}/${native?'macos-bridge':'browser'}-catalog-${width}-${theme}.png`});
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log(JSON.stringify({widths:[1060,820,390,320],themes:['light','dark'],nativeBridge:true,titlebarReserved:64,hierarchy:true,requiredLabels:true,search:true,overflow:false}));
}finally{await browser.close();await server.app.close();rmSync(dir,{recursive:true,force:true});}
