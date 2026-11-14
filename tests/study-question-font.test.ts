import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {chromium,type Browser} from 'playwright';
import * as font from '../packages/study/src/question-font.js';
import {readQuestions,applyAnswers,questionRoots} from '../packages/study/src/page.js';
import {answerQuestion} from '../packages/study/src/model.js';
import {StudyConfig} from '../packages/contracts/src/study.js';
// Synthetic TTF fixture adapted from chaoxing-ai-assistant's MIT-licensed
// tests/font-dependencies-dom.cjs (Copyright 2026 zhu-hailin). The complete
// upstream copyright and license remain in third_party/chaoxing-ai-assistant.
function triangleFont(twoGlyphs = false) {
    const glyphs = twoGlyphs ? 3 : 2;
    const head = Buffer.alloc(54); head.writeUInt32BE(0x00010000, 0); head.writeUInt16BE(1000, 18);
    const hhea = Buffer.alloc(36); hhea.writeUInt32BE(0x00010000, 0); hhea.writeUInt16BE(glyphs, 34);
    const maxp = Buffer.alloc(32); maxp.writeUInt32BE(0x00010000, 0); maxp.writeUInt16BE(glyphs, 4);
    const hmtx = Buffer.alloc(glyphs * 4); for (let index = 0; index < glyphs; index++) hmtx.writeUInt16BE(500, index * 4);
    const cmap = Buffer.alloc(44); cmap.writeUInt16BE(1, 2); cmap.writeUInt16BE(3, 4); cmap.writeUInt16BE(1, 6); cmap.writeUInt32BE(12, 8);
    const f = cmap.subarray(12); f.writeUInt16BE(4, 0); f.writeUInt16BE(32, 2); f.writeUInt16BE(4, 6); f.writeUInt16BE(4, 8); f.writeUInt16BE(1, 10);
    f.writeUInt16BE(twoGlyphs ? 19969 : 19968, 14); f.writeUInt16BE(65535, 16); f.writeUInt16BE(19968, 20); f.writeUInt16BE(65535, 22);
    f.writeInt16BE(1 - 19968, 24); f.writeUInt16BE(1, 26);
    const loca = Buffer.alloc((glyphs + 1) * 2); loca.writeUInt16BE(10, 4); if (twoGlyphs) loca.writeUInt16BE(20, 6);
    const glyf = Buffer.alloc(twoGlyphs ? 40 : 20); glyf.writeInt16BE(1, 0); glyf.writeInt16BE(100, 6); glyf.writeInt16BE(100, 8); glyf.writeUInt16BE(2, 10);
    glyf.set([49, 51, 39, 100, 100, 100], 14);
    if (twoGlyphs) { glyf.copy(glyf, 20, 0, 20); glyf[37] = 80; }
    const tables: Record<string, Buffer> = { cmap, glyf, head, hhea, hmtx, loca, maxp };
    const names = Object.keys(tables); let size = 12 + 16 * names.length;
    for (const name of names) size += (tables[name].length + 3) & ~3;
    const font = Buffer.alloc(size); font.writeUInt32BE(0x00010000, 0); font.writeUInt16BE(names.length, 4);
    let offset = 12 + names.length * 16;
    names.forEach((name, index) => {
        const record = 12 + index * 16; font.write(name, record, 4, 'ascii');
        font.writeUInt32BE(offset, record + 8); font.writeUInt32BE(tables[name].length, record + 12);
        tables[name].copy(font, offset); offset += (tables[name].length + 3) & ~3;
    });
    return font;
}
const table={'c68199be':20057}; // Triangle fixture glyph maps to 乙; not a platform font.
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({channel:'chromium',headless:true});});
afterAll(async()=>{await browser.close();});
afterEach(()=>vi.restoreAllMocks());
const url='https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1';
const style=`<style>@font-face{font-family:font-cxsecret;src:url('data:font/ttf;base64,${triangleFont().toString('base64')}')}.font-cxsecret{font-family:font-cxsecret}.plain{font-family:Arial}</style>`;
const question=`<div class="singleQuesId" data-questionid="1"><h3 class="font-cxsecret">单选题：一<span class="plain">一</span><span hidden>隐藏干扰</span><span style="opacity:0">透明干扰</span><span aria-hidden="true">辅助图标</span><script type="text/plain">脚本干扰</script></h3><label><input type="radio" name="answer"><span class="font-cxsecret">一</span></label><label><input type="radio" name="answer">普通选项</label></div>`;
it('固定的本地解析器读取真实 TTF 字节，匹配字形；系统回退文字原样保留',()=>{
 expect(font.decodeQuestionFont(triangleFont(),[19968,20013],table)).toEqual({'19968':'乙','20013':'中'});
 expect(()=>font.decodeQuestionFont(triangleFont(),[19968],{})).toThrow('未能完整还原');
 expect(()=>font.decodeQuestionFont(triangleFont(true),[19968,19969],table)).toThrow('未能完整还原');
 expect(()=>font.decodeQuestionFont(new Uint8Array([1,2,3]),[19968],table)).toThrow('未能完整还原');
});
it('先还原题干和选项，再生成模型输入；重复读取及填写复核不会二次还原或改写官网文字',async()=>{
 const original=font.readQuestionFontMaps;
 vi.spyOn(font,'readQuestionFontMaps').mockImplementation((frame,selector)=>original(frame,selector,table));
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:style+question}));
 try{
  await page.goto(url);
  const questions=await readQuestions(page.mainFrame());
  expect(questions).toMatchObject([{stem:'单选题：乙一',options:['乙','普通选项']}]);
  const request=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'{"answers":["1"]}'},finish_reason:'stop'}]})));
  await answerQuestion(StudyConfig.parse({model:'fixture'}),'fixture-key',questions[0],new AbortController().signal,undefined,request);
  expect(JSON.parse(JSON.parse(request.mock.calls[0][1].body).messages.at(-1).content)).toMatchObject({stem:'单选题：乙一',options:[{text:'乙'},{text:'普通选项'}]});
  expect(await readQuestions(page.mainFrame())).toEqual(questions);
  expect(await page.locator('h3').textContent()).toContain('单选题：一一');
  expect(await page.locator('h3').getAttribute('class')).toBe('font-cxsecret');
  await applyAnswers(page,page.mainFrame(),questions,[['1']],page.url());
  expect(await page.locator('input').first().isChecked()).toBe(true);
  expect(await readQuestions(page.mainFrame())).toEqual(questions);
 }finally{await page.close();}
});
it('无法读取、损坏或不完整的替换字体不产生模型题干，不修改页面',async()=>{
 for(const source of ['',`@font-face{font-family:font-cxsecret;src:url('/external.ttf')}`,`@font-face{font-family:font-cxsecret;src:url('data:font/ttf;base64,AA==')}`]){
  const page=await browser.newPage();
  await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<style>${source}.font-cxsecret{font-family:font-cxsecret}</style>${question}`}));
  try{await page.goto(url);expect(await readQuestions(page.mainFrame(),false)).toHaveLength(1);await expect(readQuestions(page.mainFrame())).rejects.toThrow('未能完整还原');expect(await page.locator('h3').textContent()).toContain('单选题：一一');expect(await page.locator('input:checked').count()).toBe(0);}finally{await page.close();}
 }
});
it('普通中文、英语、引号不误解码；未使用的字体和题目外字体不影响读取',async()=>{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<style>@font-face{font-family:font-cxsecret;src:url('data:font/ttf;base64,AA==');unicode-range:U+2018-2019}</style><p class="font-cxsecret" style="font-family:font-cxsecret">题目外一</p><div class="singleQuesId"><h3 class="font-cxsecret" style="font-family:Arial">单选题：正常中文 “English”</h3><label><input type=radio>甲</label><label><input type=radio>乙</label></div>`}));
 try{await page.goto(url);expect(await readQuestions(page.mainFrame())).toMatchObject([{stem:'单选题：正常中文 “English”',options:['甲','乙']}]);
  await page.locator('h3').evaluate(el=>(el as HTMLElement).style.fontFamily='font-cxsecret');
  expect(await readQuestions(page.mainFrame())).toMatchObject([{stem:'单选题：正常中文 “English”'}]);
 }finally{await page.close();}
});
it('缺字占位符不送给模型；隐藏的替换字体不触发还原',async()=>{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<div class="singleQuesId"><h3>题干<span style="opacity:0;font-family:font-cxsecret">一</span></h3><label><input type=radio>甲</label><label><input type=radio>乙</label></div>`}));
 try{await page.goto(url);expect(await readQuestions(page.mainFrame())).toMatchObject([{stem:'题干'}]);await page.locator('h3').evaluate(el=>el.textContent='题干�');await expect(readQuestions(page.mainFrame())).rejects.toThrow('无法识别的字符');}finally{await page.close();}
});
it('字体来源按实际 unicode-range 对应，不将其他字体的字形套到题目上',async()=>{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:style+`<style>@font-face{font-family:Other;src:url('data:font/ttf;base64,AA==')}@font-face{font-family:font-cxsecret;src:url('data:font/ttf;base64,AA==');unicode-range:U+2018-2019}</style>`+question}));
 try{await page.goto(url);const maps=await font.readQuestionFontMaps(page.mainFrame(),questionRoots,table);expect(maps.find(m=>m.characters['19968'])?.characters['19968']).toBe('乙');
  await page.addStyleTag({content:`@font-face{font-family:font-cxsecret;src:url('data:font/ttf;base64,AA==');unicode-range:U+4???}`});
  await expect(font.readQuestionFontMaps(page.mainFrame(),questionRoots,table)).rejects.toThrow('未能完整还原');
 }finally{await page.close();}
});
it('旧版可见选项列表即使标 aria-hidden 仍读取文字，font-size:0 的父列表不吞掉已恢复字号的选项',async()=>{
 const original=font.readQuestionFontMaps;
 vi.spyOn(font,'readQuestionFontMaps').mockImplementation((frame,selector)=>original(frame,selector,table));
 const page=await browser.newPage();
 await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:style+`<div class="singleQuesId"><h3>单选题：选项</h3><ul class="Zy_ulTop" aria-hidden="true" style="font-size:0"><li class="font-cxsecret before-after" style="font-size:14px" onclick="addChoice(this)"><label class="before"><span class="num_option">A</span></label><a class="after">一<span aria-hidden="true">干扰</span></a></li></ul></div>`}));
 try{await page.goto(url);expect(await readQuestions(page.mainFrame())).toMatchObject([{options:['乙']}]);}finally{await page.close();}
});
