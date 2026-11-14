import { beforeAll, afterAll, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { solveVideoQuizzes, type VideoQuizAttempts } from '../packages/study/src/video-quiz.js';
import { keepUnipusActive, releaseUnipusActivity } from '../packages/study/src/unipus-activity.js';
let browser: Browser, page: Page;
const url = 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1';
const native = readFileSync('third_party/chaoxing-ai-assistant/tests/fixtures/video-quiz-tktopic.html','utf8');
beforeAll(async()=>{browser=await chromium.launch({channel:'chromium',headless:true});});
afterAll(async()=>{await browser.close();});
beforeEach(async()=>{page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<html><body></body></html>'}));});
afterEach(async()=>{await page.close();});
async function videoQuiz(behavior: string, multiple = false) {
 await page.goto(url);
 await page.setContent('<video id="v" width="400" height="220"></video>'+native);
 if(multiple)await page.locator('input').evaluateAll(nodes=>nodes.forEach(n=>(n as HTMLInputElement).type='checkbox'));
 await page.locator('#videoquiz-submit').evaluate((n,behavior)=>{
  (n as HTMLElement).onclick=()=>{
   const choices=[...document.querySelectorAll<HTMLInputElement>('input')].flatMap((n,i)=>n.checked?[i+1]:[]);
   const attempts=JSON.parse(document.body.dataset.attempts||'[]');attempts.push(choices);document.body.dataset.attempts=JSON.stringify(attempts);
   if(behavior==='ambiguous')return;
   if(behavior==='changed'){document.querySelector('.tkItem_title')!.textContent='changed';return;}
   const right=behavior==='multiple'?JSON.stringify(choices)==='[1,3]':choices[0]===3;
   if(right){document.querySelector('#spanHas')!.textContent='回答正确';(document.querySelector('#videoquiz-continue') as HTMLElement).style.display='block';}
   else{const feedback=document.querySelector('#spanNot') as HTMLElement;feedback.style.display='block';feedback.textContent='真遗憾，再接再厉！';}
   if(right)(document.querySelector('#spanNot') as HTMLElement).style.display='none';
  };
 },behavior);
 await page.locator('#videoquiz-continue').evaluate(n=>(n as HTMLElement).onclick=()=>document.querySelector('.ans-videoquiz')!.remove());
}
it('真实 tkTopic 结构在连续相同错误反馈后穷举至正确，并关闭弹题继续',async()=>{
 await videoQuiz('single');const attempts:VideoQuizAttempts=new Map();
 expect(await solveVideoQuizzes(page,attempts,new AbortController().signal,()=>{})).toBe(true);
 expect(JSON.parse(await page.locator('body').getAttribute('data-attempts')||'[]')).toEqual([[1],[2],[3]]);
 expect(await page.locator('.ans-videoquiz').count()).toBe(0);
});
it('多选穷举非空子集，准确回读并清除上一组选择',async()=>{
 await videoQuiz('multiple',true);
 await solveVideoQuizzes(page,new Map(),new AbortController().signal,()=>{});
 expect(JSON.parse(await page.locator('body').getAttribute('data-attempts')||'[]')).toEqual([[1],[2],[1,2],[3],[1,3]]);
});
it('只有 tkTopic 包装的视频弹题仍处理，不落入章节测验暂停分支', async () => {
 await videoQuiz('single');
 await page.locator('.ans-videoquiz').evaluate(n => { n.setAttribute('class', 'x-component'); });
 await page.locator('#videoquiz-continue').evaluate(n => (n as HTMLElement).onclick = () => document.querySelector('.tkTopic')!.remove());
 const { readQuestions } = await import('../packages/study/src/page.js');
 expect(await readQuestions(page.mainFrame())).toEqual([]);
 expect(await solveVideoQuizzes(page, new Map(), new AbortController().signal, () => {})).toBe(true);
 expect(JSON.parse(await page.locator('body').getAttribute('data-attempts') || '[]')).toEqual([[1], [2], [3]]);
});
it('隐藏 iframe 中的章节测验与弹题都不参与播放循环', async () => {
 await page.goto(url);
 await page.route('**/hidden-frame', r => r.fulfill({contentType:'text/html',body:'<video width="320" height="180"></video>'+native+'<div class="TiMu"><h3>章节测验</h3></div>'}));
 await page.setContent('<div hidden><iframe src="https://mooc1.chaoxing.com/hidden-frame"></iframe></div>');
 await page.waitForTimeout(100);
 const { readQuestions } = await import('../packages/study/src/page.js');
 const frame = page.frames().find(f => f.url().endsWith('/hidden-frame'))!;
 expect(await readQuestions(frame)).toEqual([]);
 expect(await solveVideoQuizzes(page, new Map(), new AbortController().signal, () => {})).toBe(false);
});
it('提交结果不明不重试，手动继续也不会再次提交',async()=>{
 await videoQuiz('ambiguous');const attempts:VideoQuizAttempts=new Map();
 await expect(solveVideoQuizzes(page,attempts,new AbortController().signal,()=>{})).rejects.toThrow('结果未确认');
 await expect(solveVideoQuizzes(page,attempts,new AbortController().signal,()=>{})).rejects.toThrow('上次提交');
 expect(JSON.parse(await page.locator('body').getAttribute('data-attempts')||'[]')).toHaveLength(1);
},10000);
it('提交期间换题暂停，验证码及考试不能穷举，取消立即停止',async()=>{
 await videoQuiz('changed');await expect(solveVideoQuizzes(page,new Map(),new AbortController().signal,()=>{})).rejects.toThrow('内容已变化');
 await videoQuiz('single');await page.locator('body').evaluate(n=>n.insertAdjacentHTML('beforeend','<div data-captcha>验证码</div>'));
 await expect(solveVideoQuizzes(page,new Map(),new AbortController().signal,()=>{})).rejects.toThrow('验证');
 await page.goto('https://mooc1.chaoxing.com/exam/doExam');await expect(solveVideoQuizzes(page,new Map(),new AbortController().signal,()=>{})).rejects.toThrow('页面已变化');
 await videoQuiz('single');const c=new AbortController();c.abort();await expect(solveVideoQuizzes(page,new Map(),c.signal,()=>{})).rejects.toThrow();
 expect(await page.locator('body').getAttribute('data-attempts')).toBeNull();
});
it('U校园保活按间隔发活动，普通超时提示自动确认，不提交答案或构造网络心跳',async()=>{
 let requests=0;page.on('request',()=>requests++);
 await page.goto('https://ucontent.unipus.cn/course/#/reading');
 await page.setContent(`<div role="dialog">长时间未操作，是否继续学习？<button onclick="this.parentElement.remove()">继续学习</button></div><button onclick="document.body.dataset.submitted='yes'">提交</button><video data-coursewatch-played="true"></video>`);
 await page.evaluate(()=>document.body.addEventListener('mousemove',()=>document.body.dataset.moves=String(Number(document.body.dataset.moves||0)+1)));
 const initial=requests;expect(await keepUnipusActive(page,undefined,0)).toBe(true);expect(await page.locator('[role=dialog]').count()).toBe(0);
 expect(await page.locator('video').getAttribute('data-coursewatch-played')).toBeNull();
 const count=await page.locator('body').getAttribute('data-moves');expect(await keepUnipusActive(page,undefined,1000)).toBe(false);expect(await page.locator('body').getAttribute('data-moves')).toBe(count);
 expect(await keepUnipusActive(page,undefined,299999)).toBe(false);expect(await keepUnipusActive(page,undefined,300000)).toBe(true);expect(requests).toBe(initial);expect(await page.locator('body').getAttribute('data-submitted')).toBeNull();await releaseUnipusActivity(page);
});
it('U校园保活不确认身份验证，不碰未知继续按钮；取消不产生活动',async()=>{
 await page.goto('https://ucontent.unipus.cn/course/#/reading');
 await page.setContent(`<div role="dialog">请本人完成身份验证后继续学习<button onclick="document.body.dataset.clicked='yes'">继续</button></div>`);
 await expect(keepUnipusActive(page)).rejects.toThrow('本人确认');expect(await page.locator('body').getAttribute('data-clicked')).toBeNull();
 await page.setContent('<div role="dialog">购买课程<button onclick="document.body.dataset.clicked=\'yes\'">继续</button></div>');await keepUnipusActive(page);expect(await page.locator('body').getAttribute('data-clicked')).toBeNull();
 const cancel=new AbortController();cancel.abort();await expect(keepUnipusActive(page,cancel.signal)).rejects.toThrow();await releaseUnipusActivity(page);
});
it('U校园后台保活和超时继续只在页面内发事件，不移动浏览器鼠标或置前窗口',async()=>{
 await page.goto('https://ucontent.unipus.cn/course/#/reading');
 await page.setContent(`<div class="reading-content">阅读内容</div><div role="dialog">长时间未操作，是否继续学习？<button onclick="this.parentElement.remove()">继续学习</button></div>`);
 await page.evaluate(()=>{document.body.dataset.moves='0';document.body.dataset.downs='0';document.addEventListener('mousemove',()=>document.body.dataset.moves=String(Number(document.body.dataset.moves)+1));document.addEventListener('mousedown',()=>document.body.dataset.downs=String(Number(document.body.dataset.downs)+1));});
 const move=vi.spyOn(page.mouse,'move').mockRejectedValue(new Error('保活不得移动浏览器鼠标'));
 const front=vi.spyOn(page,'bringToFront').mockRejectedValue(new Error('保活不得置前窗口'));
 const cdp=vi.spyOn(page.context(),'newCDPSession').mockRejectedValue(new Error('保活不得模拟窗口焦点'));
 try {
  expect(await keepUnipusActive(page,undefined,0)).toBe(true);
  expect(await page.locator('[role=dialog]').count()).toBe(0);
  expect(await keepUnipusActive(page,undefined,299999)).toBe(false);
  expect(await keepUnipusActive(page,undefined,300000)).toBe(true);
  expect(await page.locator('body').getAttribute('data-moves')).toBe('2');
  expect(await page.locator('body').getAttribute('data-downs')).toBe('0');
  expect(move).not.toHaveBeenCalled();expect(front).not.toHaveBeenCalled();expect(cdp).not.toHaveBeenCalled();
 }finally{await releaseUnipusActivity(page);move.mockRestore();front.mockRestore();cdp.mockRestore();}
});
