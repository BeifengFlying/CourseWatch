import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { findChaoxingCourseURL } from '../packages/study/src/launch.js';
import { waitForCourseCatalog } from '../packages/study/src/catalog.js';
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ channel: 'chromium', headless: true }); });
afterAll(async () => { await browser.close(); });
it('先打开课程导航，同一课程封面和标题的重复链接只算一个入口，按教学班区分', async () => {
  const page = await browser.newPage();
  const destination = 'https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=1&clazzid=2&cpi=3';
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: route.request().url().includes('/visit/interaction')
    ? `<a href="${destination}">封面</a><a href="${destination}">同名课程</a><a href="${destination.replace('clazzid=2', 'clazzid=4')}">同名课程另一班</a>`
    : `<button onclick="document.querySelector('iframe').src='https://mooc2-ans.chaoxing.com/visit/interaction'">课程</button><iframe></iframe>` }));
  try {
    await page.goto('https://i.chaoxing.com/base');
    expect(await findChaoxingCourseURL(page, '1', '2')).toBe(destination);
    expect(await findChaoxingCourseURL(page, '1', '4')).toBe(destination.replace('clazzid=2', 'clazzid=4'));
  } finally { await page.close(); }
});
it('等待异步目录 iframe，读取课程首页任务点和新版章节名称', async () => {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: route.request().url().includes('/studentcourse')
    ? `<p>已完成任务点: 0/70</p><div class="chapter_item" id="cur1"><div class="catalog_name"><a>1.1 第一节</a></div><i class="icon_Completed" hidden></i></div>`
    : `<script>setTimeout(()=>{const f=document.createElement('iframe'); f.src='https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse';document.body.append(f)},600)</script>` }));
  try {
    await page.goto('https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu');
    expect(await waitForCourseCatalog(page, { id: 'one', name: '模拟课程', platform: 'chaoxing' }, 3000)).toMatchObject({ completed: 0, total: 70, chapters: [{ name: '1.1 第一节', complete: null }] });
  } finally { await page.close(); }
});
it('目录尚未加载时保留失败状态，不能当成零进度', async () => {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<p>Loading</p>' }));
  try {
    await page.goto('https://mooc2-ans.chaoxing.com/mycourse/studentcourse');
    await expect(waitForCourseCatalog(page, { id: 'one', name: '模拟课程', platform: 'chaoxing' }, 400)).rejects.toThrow('尚未识别');
  } finally { await page.close(); }
});

it('默认活动页先切换章节，只读查询不点击原生章节入口；0/0与章节完成分开读取', async () => {
  const page=await browser.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:route.request().url().includes('/studentcourse')
    ? '<p>已完成任务点: 0/0</p><div class="chapter_item" id="cur1" onclick="document.body.dataset.opened=\'yes\'"><div class="catalog_name">第一节</div><div class="catalog_task">已完成</div></div><div class="chapter_item" id="cur2"><div class="catalog_name">第二节</div><div class="catalog_task">0</div></div>'
    : '<button onclick="document.querySelector(\'iframe\').src=\'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse\'">章节</button><iframe src="about:blank"></iframe>'}));
  try{
    await page.goto('https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu');
    const result=await waitForCourseCatalog(page,{id:'data',name:'模拟数据结构',platform:'chaoxing'});
    expect(result).toMatchObject({completed:0,total:0,percent:null,chapters:[{name:'第一节',complete:true},{name:'第二节',complete:null}]});
    expect(await page.frames().at(-1)!.locator('body').getAttribute('data-opened')).toBeNull();
  }finally{await page.close();}
});

it('从目录 iframe 点击原生章节入口，跳过锁定章节，沿官网跳转进入学习页',async()=>{
  const {openChaoxingChapter}=await import('../packages/study/src/launch.js');
  const context=await browser.newContext(),page=await context.newPage();
  let lockedRequested=false;
  await page.route('**/*',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/locked')lockedRequested=true;
    return route.fulfill({contentType:'text/html; charset=utf-8',body:path.includes('/studentcourse')
      ? `<script>function toOld(){top.location.href='https://mooc2-ans.chaoxing.com/mooc-ans/mycourse/studentstudy?chapterId=2'}</script><div id="cur1" class="chapter_item locked" onclick="location.href='/locked'"><a href="https://mooc2-ans.chaoxing.com/mycourse/studentstudy?chapterId=1">锁定章节</a></div><div id="cur2" class="chapter_item" onclick="toOld()"><a class="clicktitle">第二章</a></div>`
      : path.includes('/studentstudy') ? `<p>章节已打开</p><video width=320 height=180></video><script>const media=document.querySelector('video');Object.defineProperty(media,'paused',{get:()=>!media.dataset.played});media.play=async()=>{media.dataset.played='true';};</script>` : '<iframe src="https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse"></iframe>'});
  });
  try{
    await page.goto('https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu');
    const chapter=await openChaoxingChapter(context,page);
    expect(chapter.url()).toContain('chapterId=2');expect(lockedRequested).toBe(false);
    const {mediaTick}=await import('../packages/study/src/page.js');
    expect(await mediaTick(chapter.mainFrame())).toMatchObject({kind:'playing'});
    expect(await chapter.locator('video').getAttribute('data-played')).toBe('true');
    expect(await chapter.locator('video').evaluate(n=>(n as HTMLMediaElement).playbackRate)).toBe(1);
  }finally{await context.close();}
});

it('从折叠目录直接进入所选章节并恢复栏目，缺失或锁定位置不能退回第一章',async()=>{
 const {openChaoxingChapter}=await import('../packages/study/src/launch.js');
 const context=await browser.newContext(),page=await context.newPage(),opened:string[]=[];
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.pathname.includes('studentstudy'))opened.push(url.searchParams.get('chapterId')!);
  return route.fulfill({contentType:'text/html; charset=utf-8',body:url.pathname.includes('studentstudy') ? `<div id="cur2" class="posCatalog_select posCatalog_active"><span class="posCatalog_name">第二章</span></div><ul id="prev_tab"><li id="dct1" class="active">视频</li><li id="dct2" onclick="document.querySelector('.active').classList.remove('active');this.classList.add('active')">章节检测</li></ul>` : `<aside hidden><div id="cur1" class="chapter_item" onclick="location.href='/mycourse/studentstudy?chapterId=1'"><span class="catalog_name">第一章</span></div><div id="cur2" class="chapter_item" onclick="location.href='/mycourse/studentstudy?chapterId=2'"><span class="catalog_name">第二章</span></div><div id="cur3" class="chapter_item locked"><span class="catalog_name">第三章</span></div></aside>`});
 });
 try{
  await page.goto('https://mooc1.chaoxing.com/mycourse/studentcourse');
  const loaded=await openChaoxingChapter(context,page,{chapterId:'2',tabId:'dct2'});
  expect(opened).toEqual(['2']);expect(await loaded.locator('#dct2').getAttribute('class')).toBe('active');
  for(const id of ['3','missing']){await page.goto('https://mooc1.chaoxing.com/mycourse/studentcourse');await expect(openChaoxingChapter(context,page,{chapterId:id})).rejects.toThrow('未找到或尚未开放');}
  expect(opened).toEqual(['2']);
 }finally{await context.close();}
});
