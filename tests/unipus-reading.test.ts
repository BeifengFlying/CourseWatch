import {afterAll,beforeAll,expect,it} from 'vitest';
import {chromium,type Browser,type Page} from 'playwright';
import {frameChapters} from '../packages/study/src/chapter-directory.js';
import {readStudyNavigation} from '../packages/study/src/navigation.js';
import {readUnipusQuestions,readUnipusProgress,applyUnipusAnswers} from '../packages/study/src/unipus-page.js';
let browser:Browser;
const url='https://ucontent.unipus.cn/_explorationpc_default/pc.html';
beforeAll(async()=>{browser=await chromium.launch({channel:'chromium',headless:true});});
afterAll(async()=>{await browser.close();});
async function fixture(body:string):Promise<Page>{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body}));await page.goto(url);return page;
}
const directory=`<aside class="pc-slider-content-menu"><div>
 <div class="pc-slider-menu-unit" data-role="unit"><span class="unit-label-item" title="Campus life">Unit 1 Campus life</span></div>
 <div><div class="pc-slider-menu-section" data-role="section"><span>Section A</span></div>
 <div><div class="pc-slider-menu-micro pc-menu-activity" data-role="micro"><div class="pc-slider-menu-status-circle-all"></div><span class="pc-menu-node-name">Reading</span></div></div>
 <div><div class="pc-slider-menu-micro pc-menu-default pc-menu-micro-lock" data-role="micro"><span class="pc-menu-node-name">Practice</span><span class="pc-menu-lock-icon"></span></div></div></div>
 </div><div><div class="pc-slider-menu-unit"><span class="unit-label-item">Unit 2</span></div><div><div class="pc-slider-menu-node"><span class="pc-menu-node-text">Reading</span></div></div></div></aside>`;
async function viewData(page:Page){
 await page.locator('.pc-slider-content-menu').evaluate(menu=>{
  (menu as any).__reactFiber$fixture={memoizedProps:{},return:{memoizedProps:{course:{rootNode:{children:[
   {id:'u1',caption:'Unit 1',name:'Campus life',children:[{id:'s1',name:'Section A',category:'section',children:[{id:'r1',name:'Reading',category:'micro',children:[{id:'leaf1'}]},{id:'p1',name:'Practice',category:'micro',children:[{id:'leaf2'}]}]}]},
   {id:'u2',name:'Unit 2',children:[{id:'r2',name:'Reading',category:'group'}]},
  ]}}},stateNode:{state:{unitProgressData:[{unit_id:'u1',leafs:{leaf1:{strategies:{required:true}},leaf2:{strategies:{required:false}}},micros:{'u1/r1':{state:{pass:1}},'u1/p1':{state:{pass:0}}}},{unit_id:'u2',leafs:{}}]}}}};
 });
}
it('官网并列单元和Section保留层级、当前项、锁定及官方必修策略',async()=>{
 const page=await fixture(directory);try{
  await viewData(page);const chapters=await frameChapters(page.mainFrame(),'unipus');
  expect(chapters).toMatchObject([
   {id:'r1',name:'Reading',path:[{id:'u1',name:'Unit 1 Campus life'},{id:'s1',name:'Section A'}],required:true,current:true,complete:true},
   {id:'p1',name:'Practice',required:false,locked:true,complete:false},
   {id:'r2',name:'Reading',required:null,path:[{id:'u2',name:'Unit 2'}]},
  ]);
  expect(await readStudyNavigation(page,'unipus')).toEqual({previous:false,next:false});
  expect((await readUnipusProgress(page)).progress?.chapters).toMatchObject(chapters.map(({index,current,...entry})=>entry));
  await page.locator('body').evaluate(n=>n.insertAdjacentHTML('beforeend','<div class="task-status">未完成</div>'));
  expect((await readUnipusProgress(page)).progress).toMatchObject({chapterId:'r1',chapter:'Reading',chapterComplete:true});
 }finally{await page.close();}
});
it('原生视图数据缺失或与目录不符时保留DOM层级，不推断必修属性或课程ID',async()=>{
 const page=await fixture(directory);try{
  const chapters=await frameChapters(page.mainFrame(),'unipus');
  expect(chapters[0].path?.map(p=>p.name)).toEqual(['Unit 1 Campus life','Section A']);expect(chapters[0].required).toBeNull();
  await viewData(page);await page.locator('.pc-menu-node-name').first().evaluate(n=>n.textContent='Changed');
  const changed=await frameChapters(page.mainFrame(),'unipus');expect(changed[0].id).not.toBe('r1');expect(changed[0].required).toBeNull();
 }finally{await page.close();}
});
it('同一题组分别读取单选、多选和填空，保留材料与每题题干，不把阅读容器当成题目',async()=>{
 const page=await fixture(`<div class="question-wrap"><div class="question-abs-question"><div class="question-common-abs-material">Read the passage: a student visits the library.</div>
 <div class="question-common-abs-choice"><div class="ques-title">Where does the student go?</div><div class="option-wrap"><div class="option"><div class="caption">A</div><div class="content">Library</div></div><div class="option"><div class="caption">B</div><div class="content">Gym</div></div></div></div>
 <div class="question-common-abs-choice multipleChoice"><div class="ques-title">Choose two words.</div><div class="option-wrap"><div class="option"><div class="content">Book</div></div><div class="option"><div class="content">Study</div></div></div></div>
 <div class="question-common-abs-fill-blank"><div>Complete: I read a book in the library.</div><input></div>
 </div><div class="question-abs-question"><article>Quotation</article></div></div>`);
 try{
  const qs=await readUnipusQuestions(page.mainFrame());expect(qs).toHaveLength(3);
  expect(qs[0]).toMatchObject({type:'single',options:['Library','Gym'],slots:1});expect(qs[0].stem).toContain('Where does the student go?');expect(qs[0].stem).toContain('Read the passage:');expect(qs[0].stem).not.toContain('Gym');
  expect(qs[1]).toMatchObject({type:'multiple',slots:1});expect(qs[2]).toMatchObject({type:'blank',slots:1});expect(qs[2].stem).toContain('Complete:');expect(await page.locator('[data-coursewatch-unipus-question]').count()).toBe(3);
 }finally{await page.close();}
});
it('新版ULS按子题读取按钮选项，题目回读和原生按钮选中状态一致',async()=>{
 const page=await fixture(`<div class="question-wrap"><div class="question-u-listen-speak-singlechoice-pc"><section class="uls-sc__question"><div class="uls-sc__stem-text">Choose the word.</div><div class="uls-sc__sub-options">
 <div class="uls-sc__option" role="button" aria-pressed="false" onclick="for(const n of this.parentNode.children)n.setAttribute('aria-pressed',String(n===this))"><span class="uls-sc__option-badge">A</span><div class="uls-sc__option-text">Hello</div></div>
 <div class="uls-sc__option" role="button" aria-pressed="false" onclick="for(const n of this.parentNode.children)n.setAttribute('aria-pressed',String(n===this))"><span class="uls-sc__option-badge">B</span><div class="uls-sc__option-text">World</div></div>
 </div></section></div></div>`);
 try{
  const qs=await readUnipusQuestions(page.mainFrame());expect(qs).toMatchObject([{stem:'Choose the word.',type:'single',options:['Hello','World']}]);
  await applyUnipusAnswers(page,page.mainFrame(),qs,[['2']],url,new AbortController().signal);
  expect(await page.locator('.uls-sc__option').nth(1).getAttribute('aria-pressed')).toBe('true');
  await page.locator('.uls-sc__stem-text').evaluate(n=>n.textContent='Changed');
  await expect(applyUnipusAnswers(page,page.mainFrame(),qs,[['1']],url,new AbortController().signal)).rejects.toThrow('变化');
 }finally{await page.close();}
});
it('仅关闭已核对的单元学习提示，协议与身份确认不自动点击',async()=>{
 const {unipusFrames}=await import('../packages/study/src/unipus-page.js');
 const page=await fixture('<div class="system-info-cloud-modal ant-modal">! 本单元学习时间：无限制 是否必修：必修<button class="system-info-cloud-ok-button" onclick="this.parentElement.remove()">我知道了</button></div>');
 try{
  await unipusFrames(page);expect(await page.locator('.system-info-cloud-modal').count()).toBe(0);
  await page.setContent('<div class="system-info-cloud-modal ant-modal">请阅读并同意用户协议<button class="system-info-cloud-ok-button" onclick="document.body.dataset.accepted=\'yes\'">我知道了</button></div>');
  await unipusFrames(page);expect(await page.locator('body').getAttribute('data-accepted')).toBeNull();
  await page.locator('.system-info-cloud-modal').evaluate(n=>n.firstChild!.textContent='请本人确认身份');
  await expect(unipusFrames(page)).rejects.toThrow('验证');expect(await page.locator('body').getAttribute('data-accepted')).toBeNull();
 }finally{await page.close();}
});
it('旧版自定义多选控件按原生选中类回读，隐藏iframe的练习不进入题组',async()=>{
 const page=await fixture(`<div class="question-common-abs-choice multipleChoice"><div class="ques-title">Choose two.</div><div class="option-wrap"><div class="option" onclick="this.classList.toggle('selected')"><div class="content">One</div></div><div class="option" onclick="this.classList.toggle('selected')"><div class="content">Two</div></div></div></div>`);
 try{
  const qs=await readUnipusQuestions(page.mainFrame());
  await applyUnipusAnswers(page,page.mainFrame(),qs,[['1','2']],url,new AbortController().signal);
  expect(await page.locator('.option.selected').count()).toBe(2);
  await page.locator('body').evaluate(n=>n.insertAdjacentHTML('beforeend','<iframe style="display:none" src="https://ucontent.unipus.cn/course/practice"></iframe>'));
  const iframe=await page.locator('iframe').elementHandle();const frame=await iframe!.contentFrame();await frame!.waitForLoadState();
  expect(await readUnipusQuestions(frame!)).toEqual([]);
 }finally{await page.close();}
});
