import {beforeAll,afterAll,it,expect} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {readChapterTasks,enterChapterTask,skipCompletedTask,canRequestChapterAnswers} from '../packages/study/src/chapter-tasks.js';
import {readQuestions,applyAnswers,submitChapter,chapterQuizComplete} from '../packages/study/src/page.js';
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({channel:'chromium',headless:true});});
afterAll(async()=>{await browser.close();});
const origin='https://mooc1.chaoxing.com';
it('官方完成标记和元数据不会被内层播放器未知状态盖掉',async()=>{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:r.request().url().includes('/video/')?'<video></video>':`<ul id=prev_tab><li id=dct1 class=active>视频</li></ul><div class="ans-attach-ct ans-job-finished"><div class="ans-job-icon" aria-label="任务点已完成"></div><iframe src="${origin}/video/player"></iframe></div><script>window.mArg={attachments:[{type:'video',isPassed:true}]}</script>`}));
 try{await page.goto(origin+'/mycourse/studentstudy?chapterId=1');expect(await readChapterTasks(page)).toMatchObject([{kind:'video',complete:true}]);}finally{await page.close();}
});
it('当前卡片明确标未完成时，不把缺少 isPassed 的检测留为未知',async()=>{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<ul id=prev_tab><li id=dct1 class=active>章节检测</li></ul><div class=ans-job-icon aria-label="任务点未完成">待完成</div><script>window.mArg={attachments:[{type:'workid',job:true}]}</script>`}));
 try{await page.goto(origin+'/mycourse/studentstudy?chapterId=1');expect(await readChapterTasks(page)).toMatchObject([{kind:'quiz',complete:false}]);}finally{await page.close();}
});
it('旧版字母选项只点击原生函数，读取文字、回读选中状态及保存字段',async()=>{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<style>ul{font-size:0}li{font-size:16px}</style><div class="TiMu" id="question55"><h3>单选题：选择乙</h3><ul class=Zy_ulTop>${['甲','乙'].map((s,i)=>`<li class=before-after onclick="addChoice(this)"><label class="fl before">${'AB'[i]}</label><a class="fl after">${s}</a><div class=clear></div></li>`).join('')}</ul><input type=hidden id=answer55></div><script>function addChoice(row){document.querySelectorAll('li').forEach(n=>n.classList.remove('on'));row.classList.add('on');document.getElementById('answer55').value=row.querySelector('label').textContent;}</script>`}));
 try{await page.goto(origin+'/mycourse/studentstudy?chapterId=1');const q=await readQuestions(page.mainFrame());expect(q[0].options).toEqual(['甲','乙']);await applyAnswers(page,page.mainFrame(),q,[['2']],page.url());expect(await page.locator('#answer55').inputValue()).toBe('B');}finally{await page.close();}
});
it('视频已完成而检测未完成时跳过视频，只点击原生检测栏目，不能以小节整体状态代替任务',async()=>{
 const page=await browser.newPage();
 await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="cur1" class="posCatalog_select"><span class="posCatalog_name">小节一</span></div><ul id="prev_tab"><li id="dct1" class="active">视频</li><li id="dct2" onclick="document.getElementById('dct1').classList.remove('active');this.classList.add('active');window.mArg={attachments:[{type:'workid',isPassed:false}]}">章节检测</li></ul><video></video><script>window.mArg={attachments:[{type:'video',isPassed:true}]}</script>`}));
 try{
  await page.goto(origin+'/mycourse/studentstudy?chapterId=1');
  expect(await readChapterTasks(page)).toMatchObject([{kind:'video',complete:true,current:true},{kind:'quiz',complete:null,current:false}]);
  expect(await skipCompletedTask(page,new AbortController().signal)).toBe(true);
  expect(await readChapterTasks(page)).toMatchObject([{kind:'video',complete:true,current:false},{kind:'quiz',complete:false,current:true}]);
  expect(await skipCompletedTask(page,new AbortController().signal)).toBe(false);
  expect(await page.locator('[data-completed=true]').count()).toBe(0);
 }finally{await page.close();}
});
it('直接检测只进入目标栏目；锁定、隐藏状态模板、其他站点和取消信号均不误跳',async()=>{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<ul id="prev_tab"><li id="dct1" class="active">视频<span hidden class="icon_Completed"></span></li><li id="dct2" class="locked">章节检测</li></ul><video></video>`}));
 try{
  await page.goto(origin+'/mycourse/studentstudy?chapterId=1');
  expect((await readChapterTasks(page))[0].complete).toBeNull();
  expect(await enterChapterTask(page,'quiz')).toBe(false);
  const abort=new AbortController();abort.abort();await expect(enterChapterTask(page,'quiz',abort.signal)).rejects.toThrow();
  await page.goto('https://example.com/mycourse/studentstudy');expect(await readChapterTasks(page)).toEqual([]);
 }finally{await page.close();}
});
it('新版自定义选项读取、原生点击与隐藏答案字段回读，延迟出现的确认链接只提交一次',async()=>{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`
 <div class="fanyaMarking_left"><div class="questionLi singleQuesId" data="42" id="question42"><h3 class="mark_name">多选题：选出第一和第三项</h3><div class="stem_answer">${['第一项','第二项','第三项'].map((label,i)=>`<div class="answerBg" onclick="this.firstElementChild.classList.toggle('check_answer_dx');document.getElementById('answer42').value=[...document.querySelectorAll('.check_answer_dx')].map(n=>n.getAttribute('data')).join(',')"><span class="num_option_dx" data="${i+11}">${String.fromCharCode(65+i)}</span><p class="answer_p">${label}</p></div>`).join('')}</div></div><input type="hidden" id="answer42"></div>
 <button onclick="document.body.dataset.submits=String(Number(document.body.dataset.submits||0)+1);setTimeout(()=>document.getElementById('workpop').hidden=false,600)">提交</button>
 <div id="workpop" hidden>确认提交答案？<a href="#" id="popok" onclick="event.preventDefault();this.parentElement.hidden=true;document.body.insertAdjacentHTML('beforeend','<span class=testTit_status>已提交</span>')">确认</a></div>`}));
 try{
  await page.goto(origin+'/mycourse/studentstudy?chapterId=1');
  const questions=await readQuestions(page.mainFrame());expect(questions).toMatchObject([{id:'42',type:'multiple',options:['第一项','第二项','第三项']}]);
  expect(await chapterQuizComplete(page.mainFrame())).toBe(false);
  await applyAnswers(page,page.mainFrame(),questions,[['1','3']],page.url());
  expect(await page.locator('#answer42').inputValue()).toBe('11,13');
  await submitChapter(page,page.mainFrame(),page.url(),questions);
  expect(await page.locator('body').getAttribute('data-submits')).toBe('1');
  expect(await chapterQuizComplete(page.mainFrame())).toBe(true);
  expect(await readQuestions(page.mainFrame())).toEqual([]);
 }finally{await page.close();}
});
it('自定义控件点击后没有保存或回读不一致则停止，不直接写官网答案字段',async()=>{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<div class="singleQuesId" id="question7"><h3>单选题：选择一项</h3><ul>${['甲','乙'].map((s,i)=>`<li onclick="document.querySelectorAll('.check_answer').forEach(n=>n.classList.remove('check_answer'));this.firstElementChild.classList.add('check_answer')"><span class="num_option" data="${i+1}">${i+1}</span>${s}</li>`).join('')}</ul></div><input id="answer7" type="hidden"><button>提交</button>`}));
 try{await page.goto(origin+'/mycourse/studentstudy?chapterId=1');const questions=await readQuestions(page.mainFrame());await expect(applyAnswers(page,page.mainFrame(),questions,[['2']],page.url())).rejects.toThrow('尚未保存');expect(await page.locator('#answer7').inputValue()).toBe('');}finally{await page.close();}
});
it('官网旧模板的 answertype 不是答案字段，单选、判断回读后可以自动提交',async()=>{
 const page=await browser.newPage();
 const fixture=[{id:81,stem:'单选题：选择乙',options:['甲','乙'],values:['A','B']},{id:82,stem:'判断题：判断说法',options:['对','错'],values:['true','false']}];
 await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<form>${fixture.map(q=>`<div class="singleQuesId" id="question${q.id}" data="${q.id}"><div class="TiMu" data="0"><h3>${q.stem}</h3><ul class="Zy_ulTop" aria-hidden="true">${q.options.map((text,i)=>`<li class="before-after" onclick="addChoice(this);" qid="${q.id}"><label class="fl before"><span class="num_option choice${q.id}" name="answer${q.id}" data="${q.values[i]}">${'AB'[i]}</span></label><a class="fl after">${text}</a><div class="clear"></div></li>`).join('')}</ul><input type="hidden" id="answer${q.id}" name="answer${q.id}"><input type="hidden" id="answertype${q.id}" name="answertype${q.id}" value="${q.id===81?'0':'3'}"></div></div>`).join('')}<input type="hidden" id="answerwqbid"><button type="button" onclick="document.body.dataset.submits=String(Number(document.body.dataset.submits||0)+1);document.body.insertAdjacentHTML('beforeend','<span class=testTit_status>已提交</span>')">提交</button></form><script>function addChoice(row){const id=row.getAttribute('qid');document.querySelectorAll('.choice'+id).forEach(n=>n.classList.remove('check_answer'));const marker=row.querySelector('.num_option');marker.classList.add('check_answer');document.getElementById('answer'+id).value=marker.getAttribute('data');}</script>`}));
 try{
  await page.goto(origin+'/mycourse/studentstudy?chapterId=1');const questions=await readQuestions(page.mainFrame());expect(questions).toHaveLength(2);
  await applyAnswers(page,page.mainFrame(),questions,[['2'],['2']],page.url());
  expect(await page.locator('#answer81').inputValue()).toBe('B');expect(await page.locator('#answer82').inputValue()).toBe('false');
  expect(await page.locator('#answertype81').inputValue()).toBe('0');expect(await page.locator('#answertype82').inputValue()).toBe('3');
  await submitChapter(page,page.mainFrame(),page.url(),questions);expect(await page.locator('body').getAttribute('data-submits')).toBe('1');
 }finally{await page.close();}
});
it('判断题等待官网异步保存，按题号关联外部 name 字段，只点击一次',async()=>{
 const page=await browser.newPage();
 await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<div class="singleQuesId" data-questionid="91"><h3>判断题：判断下列说法</h3><div class="answerBg" onclick="document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);this.firstElementChild.classList.add('check_answer');setTimeout(()=>document.querySelector('[name=answer91]').value='true',450)"><span class="num_option" data="true">A</span><p class="answer_p">正确</p></div><div class="answerBg"><span class="num_option" data="false">B</span><p class="answer_p">错误</p></div></div><input type="hidden" name="answer91"><button onclick="document.body.insertAdjacentHTML('beforeend','<span class=testTit_status>已提交</span>')">提交</button>`}));
 try {
  await page.goto(origin+'/mycourse/studentstudy?chapterId=1');const questions=await readQuestions(page.mainFrame());
  await applyAnswers(page,page.mainFrame(),questions,[['1']],page.url());
  expect(await page.locator('[name=answer91]').inputValue()).toBe('true');
  expect(await page.locator('body').getAttribute('data-clicks')).toBe('1');
  await submitChapter(page,page.mainFrame(),page.url(),questions);expect(await chapterQuizComplete(page.mainFrame())).toBe(true);
 }finally{await page.close();}
});
it('视频栏目即使预载题目或播放结束也不请求模型，切换检测后才允许',async()=>{
 const page=await browser.newPage();
 await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<ul id="prev_tab"><li id="dct1" class="active">视频</li><li id="dct2" onclick="document.getElementById('dct1').classList.remove('active');this.classList.add('active');document.querySelector('video').hidden=true">章节检测</li></ul><video width="320" height="180"></video><div class="TiMu"><h3>单选题：预加载的题目</h3><label><input type="radio" name="q">甲</label><label><input type="radio" name="q">乙</label></div>`}));
 try {
  await page.goto(origin+'/mycourse/studentstudy?chapterId=1');expect(await readQuestions(page.mainFrame())).toHaveLength(1);
  expect(await canRequestChapterAnswers(page)).toBe(false);
  await page.locator('video').evaluate(n=>Object.defineProperty(n,'ended',{get:()=>true}));
  expect(await canRequestChapterAnswers(page)).toBe(false);
  expect(await enterChapterTask(page,'quiz')).toBe(true);expect(await canRequestChapterAnswers(page)).toBe(true);
  await page.goto(origin+'/exam/doExam');expect(await canRequestChapterAnswers(page)).toBe(false);
 }finally{await page.close();}
});
