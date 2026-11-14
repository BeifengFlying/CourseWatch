import { beforeAll,afterAll,it,expect } from 'vitest';
import { chromium,type Browser } from 'playwright';
import { skipCompletedChapter } from '../packages/study/src/completed-chapter.js';
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({channel:'chromium',headless:true});});
afterAll(async()=>{await browser.close();});
it('学习通从已完成章节直接进入下一节，不碰该节题目或播放器，连续完成直到边界',async()=>{
 const p=await browser.newPage();
 await p.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<div class="TiMu"><h3>已完成章节的旧练习</h3><button onclick="document.body.dataset.answered='yes'">提交</button></div>${[1,2,3].map(i=>`<div id="cur${i}" class="posCatalog_select ${i===Number(new URL(r.request().url()).searchParams.get('chapterId'))?'posCatalog_active':''}"><span class="posCatalog_name" onclick="location.search='?chapterId=${i}'">第${i}节</span><i class="icon_yiwanc"></i></div>`).join('')}`}));
 try{
  await p.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1');
  for(const i of [2,3]){expect(await skipCompletedChapter(p,'chaoxing',new AbortController().signal)).toBe('skipped');expect(new URL(p.url()).searchParams.get('chapterId')).toBe(String(i));}
  expect(await skipCompletedChapter(p,'chaoxing',new AbortController().signal)).toBe('end');expect(await p.locator('body').getAttribute('data-answered')).toBeNull();
 }finally{await p.close();}
});
it('未知、未完成、隐藏完成模板及冲突状态都不能跳过，取消不导航',async()=>{
 const p=await browser.newPage();await p.route('**/*',r=>r.fulfill({body:'<html></html>'}));
 try{
  await p.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1');
  for(const marker of ['', '<i class="icon_Uncompleted"></i>','<span hidden><i class="icon_yiwanc"></i></span>','<i class="icon_yiwanc"></i><i class="icon_Uncompleted"></i>']){
   await p.setContent(`<div id="cur1" class="posCatalog_select posCatalog_active"><span class="posCatalog_name">一</span>${marker}</div><div id="cur2" class="posCatalog_select"><span class="posCatalog_name">二</span></div>`);
   expect(await skipCompletedChapter(p,'chaoxing',new AbortController().signal)).toBe('pending');
  }
  const cancel=new AbortController();cancel.abort();await expect(skipCompletedChapter(p,'chaoxing',cancel.signal)).rejects.toThrow();
 }finally{await p.close();}
});
it('U校园只按当前节完成标记跳过，未开放章节不能点击',async()=>{
 const p=await browser.newPage();await p.route('**/*',r=>r.fulfill({body:`<aside class="pc-slider-content-menu"><div data-id="1" class="pc-slider-menu-micro active" data-completed="true">One</div><div data-id="2" class="pc-slider-menu-micro" onclick="document.querySelector('.active').classList.remove('active');this.classList.add('active')">Two</div><div data-id="3" class="pc-slider-menu-micro locked">Three</div></aside>`}));
 try{
  await p.goto('https://ucontent.unipus.cn/course/reading');expect(await skipCompletedChapter(p,'unipus',new AbortController().signal)).toBe('skipped');expect(await skipCompletedChapter(p,'unipus',new AbortController().signal)).toBe('pending');
  await p.locator('[data-id="2"]').evaluate(n=>n.setAttribute('data-completed','true'));expect(await skipCompletedChapter(p,'unipus',new AbortController().signal)).toBe('end');
 }finally{await p.close();}
});
