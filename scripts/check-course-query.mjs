// Isolated fixtures: query routing and feedback, no official requests.
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../apps/local-service/src/server.ts';
import { CourseCatalogManager } from '../packages/study/src/catalog-manager.ts';
const dir=mkdtempSync(join(tmpdir(),'cw-course-query-')),token='course-query-fixture-'.repeat(6),port=17339;
process.env.COURSEWATCH_NATIVE_TOKEN=token;
const server=await createServer({dir,port,test:true});
const platform=server.store.get('platform:chaoxing',{});server.store.set('platform:chaoxing',{...platform,added:true,loginStatus:'logged_in'});
for(let i=1;i<=2;i++)server.engine.rememberCourse('chaoxing',platform.accountId,`course:${i}:class:${i}`,i===1?'模拟数据结构':'模拟基础生命科学');
const courses=server.engine.courses().filter(c=>c.platform==='chaoxing');server.engine.selectCourses('chaoxing',platform.accountId,courses.map(c=>c.id));
const samples=courses.map(c=>({courseId:c.id,name:c.name,completed:1,total:10,percent:null,chapters:[],observedAt:100,deadline:c===courses[0]?"2026-12-21 23:59":null,deadlineLabel:"学习截止"}));
server.store.set('courseProgress:chaoxing',samples);
const original=CourseCatalogManager.prototype.read;const reads=[];let finish;
CourseCatalogManager.prototype.read=async(_dir,_platform,list)=>{reads.push(list.map(c=>c.id));return await new Promise((resolve,reject)=>{finish={resolve,reject};});};
await server.app.listen({host:'127.0.0.1',port});
const browser=await chromium.launch({channel:'chromium',headless:true}),context=await browser.newContext({viewport:{width:1060,height:720}});
await context.addInitScript(token=>localStorage.setItem('coursewatch-client-token',token),token);
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const waitRead=async count=>{for(let i=0;i<100&&reads.length<count;i++)await page.waitForTimeout(20);assert.equal(reads.length,count);};
mkdirSync('docs/screenshots',{recursive:true});
try{
 await page.goto(`http://127.0.0.1:${port}/?desktop=1`);await page.getByRole('button',{name:'超星学习通',exact:true}).click();
 await page.getByText('全部课程进度',{exact:true}).click();
 const rows=page.locator('.course-progress article');await rows.last().waitFor();
 await page.waitForFunction(()=>document.querySelector('.course-deadline')?.textContent?.includes('截止'));
 assert.equal(await page.locator('.course-progress').getByText(/读取于/).count(),0);
 assert.ok(await page.locator('.course-progress').getByText('学习截止：2026-12-21 23:59',{exact:true}).count());
 const beforeCache=server.store.get('courseProgress:chaoxing',[]);
 const otherTime=await rows.nth(1).locator('.course-deadline').innerText();
 const firstName=await rows.first().locator('strong').innerText();
 const firstId=courses.find(c=>c.name===firstName)?.id;
 await rows.first().getByRole('button').click();await waitRead(1);assert.deepEqual(reads[0],[firstId]);
 assert.equal(await rows.first().getByRole('button').innerText(),'正在查询…');assert.equal(await rows.nth(1).getByRole('button').innerText(),'查询');
 assert.equal(await page.locator('.course-progress-head button').innerText(),'查询全部课程进度');
 await rows.first().getByRole('button').evaluate(n=>{for(let i=0;i<20;i++)n.dispatchEvent(new MouseEvent('click',{bubbles:true}));});assert.equal(reads.length,1);
 for(const width of [1060,820,390,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});await rows.first().scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.locator('.course-progress').evaluate(n=>n.scrollWidth<=n.clientWidth));
  await page.screenshot({path:`docs/screenshots/course-query-single-${width}-${theme}.png`});
 }
 finish.resolve({items:[{...samples.find(c=>c.courseId===firstId),completed:0,total:0,chapters:[{name:'模拟第一章',complete:true},{name:'模拟第二章',complete:null}],observedAt:200}],issues:[]});
 await rows.first().getByText('本课程进度已读取',{exact:true}).waitFor();assert.equal(await rows.nth(1).locator('.course-deadline').innerText(),otherTime);assert.ok(await rows.first().getByText('官网任务点：0 / 0。请查看下方章节状态。',{exact:true}).isVisible());
 await rows.first().locator('summary').click();
 assert.equal(await rows.first().locator('li .study-complete-icon').count(),1);
 for(const width of [1060,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await rows.first().locator('.study-complete-icon').evaluate(el=>getComputedStyle(el).color),theme==='dark'?'rgb(112, 213, 139)':'rgb(35, 122, 59)');
 }
 assert.equal(server.store.get('courseProgress:chaoxing',[]).find(c=>c.courseId!==firstId).observedAt,beforeCache.find(c=>c.courseId!==firstId).observedAt);
 await rows.nth(1).getByRole('button').click();await waitRead(2);finish.reject(new Error('模拟：章节目录未加载'));
 await rows.nth(1).getByText('模拟：章节目录未加载',{exact:true}).waitFor();assert.equal(await rows.first().getByText('模拟：章节目录未加载',{exact:true}).count(),0);
 await page.locator('.course-progress-head button').click();await waitRead(3);assert.deepEqual(new Set(reads[2]),new Set(courses.map(c=>c.id)));assert.equal(await page.locator('.course-progress-head button').innerText(),'正在查询全部…');
 finish.resolve({items:samples,issues:[]});await page.getByText('本轮课程进度已读取',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({singleCourseOnly:true,otherCacheUnchanged:true,loadingPerCourse:true,errorPerCourse:true,allExplicit:true,zeroTaskPointsExplicit:true,widths:[1060,820,390,320],themes:['light','dark'],errors}));
}finally{CourseCatalogManager.prototype.read=original;await browser.close();await server.app.close();rmSync(dir,{recursive:true,force:true});}
