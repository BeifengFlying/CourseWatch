import {it,expect,vi} from 'vitest';
import {chromium} from 'playwright';
import {cardAttachments,attachmentTasks,readCatalogTaskStates} from '../packages/study/src/catalog-tasks.js';
import type {CourseLearningProgress} from '../packages/contracts/src/study.js';
it('目录刷新读取官方卡片 JSON 的视频和检测状态，不执行页面脚本',()=>{
 const html='<script>mArg = {"attachments":[{"type":"video","isPassed":true},{"type":"workid","isPassed":false}],"note":"quote \\" } brace"}; throw new Error("must not execute");</script>';
 const attachments=cardAttachments(html)!;
 expect(attachmentTasks(attachments,'dct1')).toMatchObject([{kind:'video',complete:true},{kind:'quiz',complete:false}]);
 expect(cardAttachments('<script>mArg = {attachments: malicious()};</script>')).toBeNull();
 expect(cardAttachments('<html>需要登录</html>')).toBeNull();
});
it('同类任务部分未知或未完成时不能当作全部完成',()=>{
 expect(attachmentTasks([{type:'video',isPassed:true},{type:'video'}],'dct1')[0].complete).toBeNull();
 expect(attachmentTasks([{type:'video',isPassed:true},{type:'video',isPassed:false}],'dct1')[0].complete).toBe(false);
});
it('一次目录查询同时读取视频与章节检测，缺少完成字段时读取官网结果，锁定章节不请求',async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try {
  const context=await browser.newContext(),page=await context.newPage(),requested:string[]=[],mutations:string[]=[];
  await context.route('**/*',r=>{
   const url=new URL(r.request().url());if(r.request().method()!=='GET')mutations.push(url.pathname);
   const body=url.pathname.endsWith('/result') ? '<span class="testTit_status">已提交</span>' : url.pathname.endsWith('/cards')
    ? `<script>window.mArg={attachments:[{type:'workid'}]}</script>${url.searchParams.get('knowledgeid')==='1'?'<iframe src="https://mooc1.chaoxing.com/work/result"></iframe>':'<div class="ans-job-icon" aria-label="任务点未完成">待完成</div>'}<button onclick="fetch('/submitted',{method:'POST'})">提交</button>`
    : `<ul id="prev_tab"><li id="dct1" class="active">视频</li><li id="dct2" onclick="document.getElementById('dct1').classList.remove('active');this.classList.add('active');setTimeout(()=>document.getElementById('iframe').src='https://mooc1.chaoxing.com/knowledge/cards?knowledgeid=1&num=1',300)">章节检测</li></ul><div id="mainid"><iframe id="iframe" src="https://mooc1.chaoxing.com/knowledge/cards?knowledgeid=1&num=0"></iframe></div>`;
   return r.fulfill({contentType:'text/html; charset=utf-8',body});
  });
  vi.spyOn(context.request,'get').mockImplementation(async value=>{
   const url=new URL(String(value));requested.push(url.href);
   return {ok:()=>true,body:async()=>Buffer.from(`mArg = ${JSON.stringify({attachments:[url.searchParams.get('num')==='0'?{type:'video',isPassed:true}:{type:'workid'}]})};`),dispose:async()=>{}} as any;
  });
  await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1');
  const progress:CourseLearningProgress={courseId:'fixture',name:'模拟课程',completed:null,total:null,percent:null,observedAt:Date.now(),chapters:[{id:'1',name:'第一节',complete:null},{id:'2',name:'第二节',complete:null},{id:'3',name:'未开放',complete:null,locked:true}]};
  await readCatalogTaskStates(page,progress,8000);
  expect(progress.chapters[0].tasks).toMatchObject([{kind:'video',complete:true},{kind:'quiz',complete:true}]);
  expect(progress.chapters[1].tasks).toMatchObject([{kind:'video',complete:true},{kind:'quiz',complete:false}]);
  expect(requested).toHaveLength(4);expect(requested.some(url=>new URL(url).searchParams.get('knowledgeid')==='3')).toBe(false);
  expect(mutations).toEqual([]);expect(context.pages()).toHaveLength(1);
 }finally{await browser.close();}
});
