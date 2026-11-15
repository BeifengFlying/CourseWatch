import { unipusBrowserState, trackUnipusSession } from "./unipus-session.js";
import { chromium } from 'playwright';
import { Vault } from '../../adapters/src/vault.js';
import { browserLaunchOptions } from '../../adapters/src/browser.js';
import { inspectSession } from '../../adapters/src/session.js';
import { chaoxingCoursesUrl, parseChaoxingCourses } from '../../adapters/src/chaoxing.js';
import { courseReader } from '../../adapters/src/course-http.js';
import { findChaoxingCourseURL } from './launch.js';
import { readUnipusCourseCatalog, waitForCourseCatalog } from './catalog.js';
import { openUnipusCourses } from './unipus-launch.js';
import { watchStudyBrowser, reportStudyFailure } from './diagnostics.js';
import { readCatalogTaskStates } from './catalog-tasks.js';
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let sessionTracker: ReturnType<typeof trackUnipusSession> | undefined;
async function close() { await sessionTracker?.stop().catch(()=>{}); await browser?.close().catch(()=>{}); process.exit(0); }
process.on('disconnect',()=>void close());process.on('SIGTERM',()=>void close());
process.once('message',async (message:any)=>{
 try {
  const session=await new Vault(message.dir).read(message.platform);if(!session)throw new Error('请先登录平台');
  browser=await chromium.launch({...await browserLaunchOptions(),headless:true});
  const context=await browser.newContext({storageState:message.platform === "unipus" ? unipusBrowserState(session) : session,acceptDownloads:false});
  if(message.platform === "unipus") sessionTracker=trackUnipusSession(context,new Vault(message.dir),session);
  // Catalog inspection must not play a course while reading task flags.
  await context.route('**/*', route => route.request().resourceType() === 'media' ? route.abort() : route.continue());
  await context.addInitScript(() => document.addEventListener('play', event => { if (event.target instanceof HTMLMediaElement) event.target.pause(); }, true));
  watchStudyBrowser(context);
  const portal=await context.newPage();
  const page=message.platform==='unipus'?portal:null;
  if(page) {
    await page.goto('https://uai.unipus.cn/home',{waitUntil:'commit',timeout:30000});
    await openUnipusCourses(page);
  }
  else await portal.goto('https://i.chaoxing.com/',{waitUntil:'domcontentloaded',timeout:30000});
  const items=[];const issues=[];
  let deadlines: Map<string,string|null> | undefined;
  if(message.platform==='chaoxing') {
    try { deadlines=new Map(parseChaoxingCourses(await courseReader(context.request,'chaoxing')(chaoxingCoursesUrl)).map(c=>[`course:${c.courseId}:class:${c.classId}`,c.deadline??null])); }
    catch { issues.push('截止日期未读取到，本轮仍查询课程进度'); }
  }
  for(const [index,course] of message.courses.slice(0,20).entries()) {
   let opened: typeof page=null;
   try {
    if(page) {
      opened=page;
      if(index > 0) {
        for(const extra of context.pages().filter(p=>p!==page)) await extra.close();
        await page.goto('https://uai.unipus.cn/home',{waitUntil:'commit',timeout:30000});
        await openUnipusCourses(page);
      }
    }
    else {
      const ids=course.key.match(/^course:([^:]+):class:([^:]+)$/);
      if(!ids) throw new Error('课程标识无法识别，请重新同步课程');
      const href=await findChaoxingCourseURL(portal,ids[1],ids[2]);
      opened=await context.newPage();
      await opened.goto(href,{waitUntil:'domcontentloaded',timeout:30000});
    }
    const html=await opened.content();const session=inspectSession(html,message.platform);
    if(session.login||session.verification)throw new Error('登录失效或平台要求验证，请在官方窗口处理');
    const progress=page ? await readUnipusCourseCatalog(opened,course) : await waitForCourseCatalog(opened,course);
    if(message.platform==='chaoxing') {
      progress.deadline=deadlines?.get(course.key)??null; progress.deadlineLabel='学习截止';
      try { await readCatalogTaskStates(opened,progress,message.courses.length===1?45000:10000); }
      catch { issues.push(`${course.name}：部分视频或检测状态未读取，已保留目录结果`); }
    }
    items.push(progress);
   }catch(error) {
    await reportStudyFailure(error, 'catalog', context.pages().at(-1) ?? opened ?? undefined);
    const reason=(error as Error).message;
    issues.push(`${course.name}：${/^(U校园|教程|已点击官网|学习通登录|登录失效|课程标识|官网存在|官网课程列表|官网章节目录|尚未识别|登录已失效)/.test(reason) ? reason : '官网目录未加载完成，请稍后重试'}`);
   }
   finally {if(opened&&opened!==page)await opened.close();}
   process.send?.({partial:{items,issues}});
  }
  if(message.courses.length>20)issues.push('本轮最多读取20门课程，请按课程查询其余进度');
  process.send?.({result:{items,issues}});
 }catch(error) {await reportStudyFailure(error, 'catalog', browser?.contexts()[0]?.pages().at(-1));process.send?.({error:'课程进度读取未完成，请检查登录及官网页面后重试'});}
 finally {await sessionTracker?.stop().catch(()=>{});await browser?.close();process.disconnect?.();}
});
