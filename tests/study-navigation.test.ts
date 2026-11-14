import { beforeAll, afterAll, it, expect } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { readStudyNavigation, switchStudyItem, jumpToStudyChapter } from '../packages/study/src/navigation.js';
let browser: Browser;
beforeAll(async()=>{browser=await chromium.launch({channel:'chromium',headless:true});});
afterAll(async()=>{await browser.close();});
it('只点击相邻官方章节入口，暂停状态与平台完成标记不由导航修改',async()=>{
 const page=await browser.newPage();
 await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<input id="chapterId" value="2"><div id="cur1" class="posCatalog_select"><button class="posCatalog_name" onclick="location.search='?chapterId=1'">第一节</button></div><div id="cur2" class="posCatalog_select"><button class="posCatalog_name" onclick="location.search='?chapterId=2'">第二节</button></div><div id="cur3" class="posCatalog_select locked"><button class="posCatalog_name">锁定第三节</button></div>`}));
 try {
  await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=2');
  expect(await readStudyNavigation(page,'chaoxing')).toEqual({previous:true,next:false});
  expect(await switchStudyItem(page,'chaoxing','next')).toBe(false);
  expect(await switchStudyItem(page,'chaoxing','previous')).toBe(true);expect(page.url()).toContain('chapterId=1');
  expect(await readStudyNavigation(page,'chaoxing')).toEqual({previous:false,next:true});
  expect(await page.locator('[data-completed=true],.icon_Completed').count()).toBe(0);
 }finally{await page.close();}
});
it('U校园原生目录在同一 URL 切换时读取选中项，不能点击普通答题下一题',async()=>{
 const page=await browser.newPage();
 await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<aside class="pc-slider-content-menu"><div class="pc-slider-menu-micro active" onclick="document.querySelectorAll('.active').forEach(n=>n.classList.remove('active'));this.classList.add('active')">第一节</div><div class="pc-slider-menu-micro" onclick="document.querySelectorAll('.active').forEach(n=>n.classList.remove('active'));this.classList.add('active')">第二节</div></aside><button>下一题</button>`}));
 try{await page.goto('https://ucontent.unipus.cn/course/reading');expect(await readStudyNavigation(page,'unipus')).toEqual({previous:false,next:true});expect(await switchStudyItem(page,'unipus','next')).toBe(true);expect(await readStudyNavigation(page,'unipus')).toEqual({previous:true,next:false});}finally{await page.close();}
});
it('不支持的站点或考试页面不提供章节切换',async()=>{
 const page=await browser.newPage();await page.setContent('<button>下一节</button>');expect(await readStudyNavigation(page,'chaoxing')).toEqual({previous:false,next:false});await page.close();
});

it('侧栏折叠且地址栏不变时，连续跳过三次检测并等候实际章节加载', async () => {
 const {skipStudyCheck} = await import('../packages/study/src/skip-check.js');
 const {readStudyProgress} = await import('../packages/study/src/progress.js');
 const page=await browser.newPage();
 await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:new URL(r.request().url()).pathname.includes('/knowledge/cards') ? '<p>已加载当前章节</p>' : `
 <aside style="display:none">${[1,2,3,4].map(i=>`<div id="cur${i}" class="posCatalog_select ${i===1?'posCatalog_active':''}"><span class="posCatalog_name" onclick="go(${i})">第${i}节</span></div>`).join('')}<div id="cur5" class="posCatalog_select locked"><span class="posCatalog_name" onclick="document.body.dataset.locked='yes'">未开放</span></div></aside>
 <div id="mainid"><iframe id="iframe" src="/knowledge/cards?knowledgeid=1"></iframe></div>
 <button onclick="document.body.dataset.submitted='yes'">提交</button>
 <script>function go(i){document.querySelector('.posCatalog_active').classList.remove('posCatalog_active');document.getElementById('cur'+i).classList.add('posCatalog_active');setTimeout(()=>document.getElementById('iframe').src='/knowledge/cards?knowledgeid='+i,650)}</script>`}));
 try {
  await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1');
  for(const i of [2,3,4]) {
   const started=Date.now();expect(await skipStudyCheck(page,'chaoxing',new AbortController().signal)).toBe(true);
   expect(Date.now()-started).toBeGreaterThanOrEqual(600);
   expect((await readStudyProgress(page))?.chapterId).toBe(String(i));
   expect(page.url()).toContain('chapterId=1');
  }
  expect(await readStudyNavigation(page,'chaoxing')).toEqual({previous:true,next:false});
  expect(await jumpToStudyChapter(page,'chaoxing','5')).toBe(false);
  expect(await page.locator('body').getAttribute('data-locked')).toBeNull();
  expect(await page.locator('body').getAttribute('data-submitted')).toBeNull();
  await page.locator('body').evaluate(n=>n.insertAdjacentHTML('beforeend','<div data-captcha>身份验证</div>'));
  await expect(jumpToStudyChapter(page,'chaoxing','2')).rejects.toThrow('验证');
 }finally{await page.close();}
});
it('隐藏 iframe 中的旧媒体错误和文档不影响当前章节',async()=>{
 const {mediaTick,documentStep}=await import('../packages/study/src/page.js');
 const page=await browser.newPage();
 await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:r.request().url().includes('old')?'<video></video><div id="viewerContainer">old</div><script>Object.defineProperty(document.querySelector("video"),"error",{get:()=>({code:4})})</script>':'<iframe style="display:none" src="/knowledge/cards?old"></iframe>'}));
 try{await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1');const frame=page.frames()[1];expect(await mediaTick(frame)).toEqual({kind:'none'});expect(await documentStep(frame)).toBe('none');}finally{await page.close();}
});
it('侧栏被零宽容器裁剪时仍使用原生目录入口',async()=>{
 const page=await browser.newPage();
 await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<aside style="width:0;overflow:hidden"><div style="width:300px"><div id="cur1" class="posCatalog_select posCatalog_active"><span class="posCatalog_name">第一节</span></div><div id="cur2" class="posCatalog_select"><span class="posCatalog_name" onclick="document.getElementById('cur1').classList.remove('posCatalog_active');document.getElementById('cur2').classList.add('posCatalog_active')">第二节</span></div></div></aside>`}));
 try{await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1');expect(await switchStudyItem(page,'chaoxing','next')).toBe(true);expect(await readStudyNavigation(page,'chaoxing')).toEqual({previous:true,next:false});}finally{await page.close();}
});
