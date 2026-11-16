import { beforeAll, afterAll, it, expect } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { readCourseCatalog } from '../packages/study/src/catalog.js';
import { inspectKeptPage } from '../packages/study/src/keep-open.js';
import { StudyStart } from '../packages/contracts/src/study.js';
import { readUnipusProgress, playUnipusMedia } from '../packages/study/src/unipus-page.js';
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({channel:'chromium',headless:true});});
afterAll(async()=>{await browser.close();});
it('读取校内课程中每本教程的任务数、百分比和班级，互不合并',async()=>{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<section><p>课程名称：模拟大学英语3（B）</p><p>班级名称：模拟B6班</p><p>计分周期：2026/09/11—2027/03/11</p><div><h3>模拟读写教程2</h3><p>已学任务：0/276</p><p>学习进度：0%</p></div><div><h3>模拟视听说教程2</h3><p>已学任务：12/270</p><p>学习进度：4.5%</p></div></section>`}));
 try{await page.goto('https://uai.unipus.cn/home');
 const a=await readCourseCatalog(page,{id:'a',name:'模拟读写教程2',platform:'unipus'}),b=await readCourseCatalog(page,{id:'b',name:'模拟视听说教程2',platform:'unipus'});
 expect(a).toMatchObject({completed:0,total:276,percent:0,group:'模拟大学英语3（B）',className:'模拟B6班',deadline:'2027-03-11',deadlineLabel:'计分截止'});expect(b).toMatchObject({completed:12,total:270,percent:4.5});
 await page.locator('h3').last().evaluate(n=>{n.textContent='模拟读写教程2';});await expect(readCourseCatalog(page,{id:'a',name:'模拟读写教程2',platform:'unipus'})).rejects.toThrow('同名');
 }finally{await page.close();}
});
it('学习通目录只采信官网任务点和明确完成标记，不从媒体时长推算',async()=>{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<p>已完成任务点：0/70</p><h4 id="cur1"><span class="posCatalog_name">第一章</span><span>剩余 3 个任务点</span></h4><h4 id="cur2" data-completed="true"><span class="posCatalog_name">第二章</span></h4>`}));
 try{await page.goto('https://mooc1.chaoxing.com/mycourse/studentcourse');const v=await readCourseCatalog(page,{id:'c',name:'模拟课程',platform:'chaoxing'});expect(v).toMatchObject({completed:0,total:70,percent:null,chapters:[{name:'第一章',complete:false,pending:3},{name:'第二章',complete:true}]});}finally{await page.close();}
});
it('保持页面模式只检查本机状态，不点击提示、播放或发网络心跳',async()=>{
 const page=await browser.newPage();let requests=0;await page.route('**/*',r=>{requests++;return r.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>Quotation</h1><button onclick="document.body.dataset.clicked=\'yes\'">继续</button><video controls></video>'});});
 try{await page.goto('https://ucontent.unipus.cn/course/#/reading');const initial=requests;
 await page.locator('video').evaluate(n=>{(n as HTMLVideoElement).play=async()=>{document.body.dataset.played='yes';};});
 await inspectKeptPage(page,'unipus');await inspectKeptPage(page,'unipus');expect(requests).toBe(initial);expect(await page.locator('body').getAttribute('data-clicked')).toBeNull();expect(await page.locator('body').getAttribute('data-played')).toBeNull();
 await page.locator('body').evaluate(n=>n.insertAdjacentHTML('beforeend','<div role="dialog">长时间未操作，请确认继续学习</div>'));await expect(inspectKeptPage(page,'unipus')).rejects.toThrow('本人确认');
 await inspectKeptPage(page,'unipus',true);expect(await page.locator('body').getAttribute('data-clicked')).toBeNull();
 await page.locator('[role=dialog]').evaluate(n=>{n.textContent='请本人确认身份';});await expect(inspectKeptPage(page,'unipus',true)).rejects.toThrow('验证');
 }finally{await page.close();}
});
it('目录读取支持教程页，播放器被暂停后不反复调用 play',async()=>{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>Quotation</h1><aside class="pc-slider-content-menu"><div class="pc-slider-menu-micro"><span class="pc-menu-node-name">Quotation</span></div><div class="pc-slider-menu-micro"><span class="pc-menu-node-name">Preview</span></div></aside><video controls width="320" height="180"></video>'}));
 try{await page.goto('https://ucontent.unipus.cn/course/reading');expect((await readUnipusProgress(page)).progress?.chapters).toMatchObject([{name:'Quotation',complete:null,required:null,locked:false},{name:'Preview',complete:null,required:null,locked:false}]);
 await page.locator('video').evaluate(n=>{const m=n as HTMLVideoElement;Object.defineProperty(m,'paused',{value:true,configurable:true});m.play=async()=>{document.body.dataset.plays=String(Number(document.body.dataset.plays||0)+1);};});
 await playUnipusMedia(page);await expect(playUnipusMedia(page)).rejects.toThrow('已暂停');expect(await page.locator('body').getAttribute('data-plays')).toBe('1');
 }finally{await page.close();}
});
it('保留页面必须设置关闭时间，后台状态不能由任意 URL 决定',()=>{
 expect(StudyStart.safeParse({operation:'keep-open'}).success).toBe(false);expect(StudyStart.safeParse({operation:'keep-open',closeAfterMinutes:30}).success).toBe(true);expect(StudyStart.safeParse({url:'https://other.example/'}).success).toBe(false);
});

it('完整上游目录模块通过宿主桥读取，隐藏完成标记和未知状态不会变成已完成',async()=>{
 const browser=await chromium.launch({headless:true,channel:'chromium'});
 try{
  const page=await browser.newPage();let writes=0;
  await page.route('**/*',route=>{if(route.request().method()!=='GET')writes++;return route.fulfill({contentType:'text/html; charset=utf-8',body:'<div id="content1"><ul id="coursetree"><li><div id="cur1" class="posCatalog_select"><div class="posCatalog_name" title="第一章">第一章</div><i class="icon_Completed"></i></div></li><li><div id="cur2" class="posCatalog_select"><div class="posCatalog_name" title="第二章">第二章</div><span class="orangeNew">3</span><i class="icon_Completed" hidden></i></div></li><li><div id="cur3" class="posCatalog_select"><div class="posCatalog_name" title="第三章">第三章</div></div></li></ul></div>'});});
  await page.goto('https://mooc2-ans.chaoxing.com/mycourse/studentstudy?courseid=1&clazzid=2&cpi=3');
  const {readUpstreamCatalog}=await import('../packages/study/src/upstream-catalog.js');
  expect(await readUpstreamCatalog(page.mainFrame())).toEqual([{name:'第一章',complete:true},{name:'第二章',complete:false,pending:3},{name:'第三章',complete:null}]);expect(writes).toBe(0);
 }finally{await browser.close();}
});
