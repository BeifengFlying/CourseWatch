// Smoke-check the exact packaged parser and browser runtime with local fixtures.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [appRoot,arch]=process.argv.slice(2);
assert.equal(process.arch,arch);
const require=createRequire(join(appRoot,'package.json'));
const {chromium}=require('playwright');
const moduleAt=path=>import(pathToFileURL(join(appRoot,'dist/server/packages/study/src',path)).href);
const {readStudyChapters}=await moduleAt('chapter-directory.js');
const {readUnipusQuestions,readUnipusProgress,applyUnipusAnswers}=await moduleAt('unipus-page.js');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();
 const url='https://ucontent.unipus.cn/_explorationpc_default/pc.html';
 await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<aside class="pc-slider-content-menu"><div><div class="pc-slider-menu-unit"><span class="unit-label-item">Unit 1 Campus</span></div><div><div class="pc-slider-menu-section">Section A</div><div class="pc-slider-menu-micro pc-menu-activity" data-id="reading" data-required="true" data-completed="false"><span class="pc-menu-node-name">Reading</span></div></div></div></aside><div class="question-wrap"><div class="question-abs-question"><div class="question-common-abs-material">Shared passage.</div><div class="question-common-abs-choice"><div class="ques-title">Choose a word.</div><div class="option-wrap"><div class="option" role="radio" aria-checked="false" onclick="this.setAttribute('aria-checked','true')"><div class="content">Library</div></div></div></div></div></div>`}));
 await page.goto(url);
 const chapters=await readStudyChapters(page,'unipus');assert.equal(chapters.length,1);
 assert.equal(chapters[0].required,true);assert.deepEqual(chapters[0].path.map(p=>p.name),['Unit 1 Campus','Section A']);
 const qs=await readUnipusQuestions(page.mainFrame());assert.equal(qs.length,1);assert.deepEqual(qs[0].options,['Library']);assert.ok(qs[0].stem.includes('Shared passage.'));
 await applyUnipusAnswers(page,page.mainFrame(),qs,[['1']],url,new AbortController().signal);
 assert.equal(await page.locator('[role=radio]').getAttribute('aria-checked'),'true');
 const {progress}=await readUnipusProgress(page);assert.equal(progress.chapterId,'reading');assert.equal(progress.chapterComplete,false);
 console.log(`U校园包内解析：${arch} 目录层级、必修属性、题组、题干、选项回读及当前状态 OK（仅本地模拟）`);
}finally{await browser.close();}
