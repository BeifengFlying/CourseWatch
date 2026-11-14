import {it,expect,vi} from 'vitest';
import {StudyConfig,STUDY_NOTICE_VERSION} from '../packages/contracts/src/study.js';

const fixture=vi.hoisted(()=>({page:null as any}));
vi.mock('../packages/adapters/src/vault.js',()=>({Vault:class{async read(){return {cookies:[],origins:[]};}}}));
vi.mock('../packages/adapters/src/browser.js',()=>({browserLaunchOptions:async()=>({channel:'chromium'}),browserStartupArgs:()=>[]}));
vi.mock('../packages/study/src/window.js',()=>({studyWindowOptions:()=>({headless:true}),setStudyWindow:async()=>{},showStudyWindow:async()=>{}}));
vi.mock('../packages/study/src/launch.js',()=>({openCourse:async(context:any)=>{
 const page=await context.newPage();fixture.page=page;
 await page.route('**/*',(r:any)=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<ul id="prev_tab"><li id="dct1" class="active">章节检测</li><li id="dct2" onclick="document.getElementById('dct1').classList.remove('active');this.classList.add('active');document.querySelector('.TiMu').hidden=true;document.querySelector('[data-quiz-status]').textContent='已完成'">视频</li></ul><div class="TiMu"><h3>单选题：测试</h3><label><input type="radio">甲</label><label><input type="radio">乙</label></div><span data-quiz-status></span><button onclick="document.body.dataset.submitted='yes'">提交</button>`}));
 await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1');return page;
}}));

it('已有模型时也可在播放中关闭章节测试，停止请求并通过原生栏目继续',async()=>{
 const previousListeners=new Map(['message','SIGTERM','disconnect'].map(event=>[event,new Set(process.listeners(event))]));
 const previousSend=process.send;const messages:any[]=[];
 process.send=((message:any)=>{messages.push(message);return true;}) as any;
 const exit=vi.spyOn(process,'exit').mockImplementation((()=>{}) as any);
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('关闭测试时不得调用模型'));
 try{
  await import('../packages/study/src/worker.js');
  process.emit('message',{action:'start',dir:'/fixture',config:StudyConfig.parse({enabled:true,noticeVersion:STUDY_NOTICE_VERSION,model:'fixture-model',answerExercises:true,chapterTests:true}),key:'fixture-key',options:{operation:'play'}},undefined);
  await vi.waitFor(()=>expect(messages.some(m=>m.status?.phase==='running')).toBe(true),{timeout:6000});
  process.emit('message',{action:'chapter-tests',enabled:false,requestId:'disable'},undefined);
  await vi.waitFor(()=>expect(messages.some(m=>m.settingsRequest==='disable')).toBe(true));
  await vi.waitFor(()=>expect(messages.some(m=>m.status?.logs?.some((l:any)=>l.message.includes('已跳过当前测试')))).toBe(true),{timeout:6000});
  expect(await fixture.page.locator('#dct2').getAttribute('class')).toBe('active');
  expect(await fixture.page.locator('body').getAttribute('data-submitted')).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
 }finally{
  process.emit('message',{action:'stop'},undefined);
  await vi.waitFor(()=>expect(exit.mock.calls.length).toBeGreaterThanOrEqual(2),{timeout:6000});
  for(const [event,before] of previousListeners)for(const listener of process.listeners(event))if(!before.has(listener))process.removeListener(event,listener);
  process.send=previousSend;exit.mockRestore();fetcher.mockRestore();
 }
});
