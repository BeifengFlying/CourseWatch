import {beforeAll,afterAll,it,expect} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {frameChapters,clickChapter} from '../packages/study/src/chapter-directory.js';
import {readStudyProgress} from '../packages/study/src/progress.js';
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true,channel:'chromium'});});
afterAll(async()=>{await browser?.close();});
it('折叠目录保留官网父子关系和小节入口，编号本身不产生层级',async()=>{
 const p=await browser.newPage();
 await p.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<ul><li><div class="posCatalog_select" id="unit1"><span class="posCatalog_title">第一章</span></div><div class="posCatalog_level" style="display:none"><ul><li><div id="cur11" class="posCatalog_select posCatalog_active"><span class="posCatalog_name">1.1 视频</span><i class="icon_Completed"></i></div><ul><li><div id="cur111" class="posCatalog_select"><span class="posCatalog_name" onclick="document.body.dataset.opened='111'">1.1.1 阅读</span></div></li></ul></li></ul></div></li><li><div id="cur2" class="posCatalog_select"><span class="posCatalog_name">2.1 无父级的小节</span></div></li></ul>`}));
 await p.goto('https://mooc1.chaoxing.com/mycourse/studentstudy');
 const chapters=await frameChapters(p.mainFrame(),'chaoxing');
 expect(chapters.map(c=>c.id)).toEqual(['11','111','2']);
 expect(chapters[0].path).toEqual([{id:'unit1',name:'第一章'}]);
 expect(chapters[1].path).toEqual([{id:'unit1',name:'第一章'},{id:'11',name:'1.1 视频'}]);
 expect(chapters[2].path).toBeUndefined();
 expect((await readStudyProgress(p))?.chapters[1].path).toEqual(chapters[1].path);
 await clickChapter(p.mainFrame(),'chaoxing',chapters[1]);
 expect(await p.locator('body').getAttribute('data-opened')).toBe('111');await p.close();
});
it('U校园分组与嵌套小节按官网容器读取，分组不成为播放队列项',async()=>{
 const p=await browser.newPage();await p.setContent(`<aside class="pc-slider-content-menu"><div class="pc-slider-menu-node" data-id="unit1"><span>Unit 1</span><div class="pc-slider-menu-node" data-id="section1"><span>Section A</span><div class="pc-slider-menu-micro active" data-id="task1">Reading</div></div></div></aside>`);
 const chapters=await frameChapters(p.mainFrame(),'unipus');expect(chapters).toHaveLength(1);
 expect(chapters[0].path).toEqual([{id:'unit1',name:'Unit 1'},{id:'section1',name:'Section A'}]);await p.close();
});
