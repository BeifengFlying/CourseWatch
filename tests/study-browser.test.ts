import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { readQuestions, applyAnswers, submitChapter, documentStep, nextNativeTab, chapterConfirmedComplete } from "../packages/study/src/page.js";
let browser: Browser, page: Page;
const origin = "https://mooc2-ans.chaoxing.com";
const fixture = `<html><body><div id="cur1" class="posCatalog_select posCatalog_active"><a class="posCatalog_name">第一章</a></div>
<div class="TiMu" id="question1"><h3 class="Zy_TItle">单选题：选择第二项</h3><ul class="Zy_ulTop"><li><label><input type="radio" name="one">第一项</label></li><li><label><input type="radio" name="one">第二项</label></li></ul></div>
<button onclick="document.body.dataset.submissions=String(Number(document.body.dataset.submissions||0)+1);if(confirm('确认提交答案？')){const marker=document.createElement('div');marker.dataset.quizCompleted='true';marker.textContent='已提交';document.body.append(marker)}">提交</button></body></html>`;
beforeAll(async () => { browser = await chromium.launch({ channel: "chromium", headless: true }); });
afterAll(async () => { await browser?.close(); });
beforeEach(async () => { page = await browser.newPage(); await page.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture })); });
afterEach(async () => { await page.close(); });
it("章节测验按实际输入控件填入，读回一致并获得提交结果", async () => {
  await page.goto(`${origin}/mycourse/studentstudy?chapterId=1`); const frame = page.mainFrame();
  const questions = await readQuestions(frame); expect(questions).toHaveLength(1); expect(questions[0].options).toEqual(["第一项", "第二项"]);
  await applyAnswers(page, frame, questions, [["2"]], page.url());
  expect(await page.locator('input[type="radio"]').nth(1).isChecked()).toBe(true);
  await submitChapter(page, frame, page.url(), questions);
  expect(await page.locator("body").getAttribute("data-submissions")).toBe("1");
  expect(await chapterConfirmedComplete(page)).toBe(false);
});
it("课程作业禁止自动填入和提交，考试禁止提交", async () => {
  await page.goto(`${origin}/work/doHomeWorkNew`); const questions = await readQuestions(page.mainFrame());
  await expect(applyAnswers(page, page.mainFrame(), questions, [["2"]], page.url())).rejects.toThrow("未填入");
  await expect(submitChapter(page, page.mainFrame(), page.url(), questions)).rejects.toThrow("章节");
  await page.goto(`${origin}/exam/doExam`); await expect(submitChapter(page, page.mainFrame(), page.url(), questions)).rejects.toThrow("章节");
});
it("异步期间题目改变或已暂停，都不能填入及提交", async () => {
  await page.goto(`${origin}/mycourse/studentstudy?chapterId=1`); const questions = await readQuestions(page.mainFrame());
  await page.locator(".Zy_TItle").evaluate(n => n.textContent = "单选题：不同题目");
  await expect(applyAnswers(page, page.mainFrame(), questions, [["2"]], page.url())).rejects.toThrow("题目发生变化");
  const cancel = new AbortController(); cancel.abort();
  await expect(submitChapter(page, page.mainFrame(), page.url(), questions, cancel.signal)).rejects.toThrow();
  expect(await page.locator("body").getAttribute("data-submissions")).toBeNull();
});
it("文档逐页操作直至末页，末页不伪造任务完成", async () => {
  await page.goto(`${origin}/mycourse/studentstudy?chapterId=1`);
  await page.setContent('<div id="viewerContainer"><input id="pageNumber" value="1"><span id="numPages">3</span><button id="next" onclick="document.getElementById(\'pageNumber\').value++">下一页</button></div>');
  expect(await documentStep(page.mainFrame(), false)).toBe("next"); expect(await page.locator("#pageNumber").inputValue()).toBe("1");
  expect(await documentStep(page.mainFrame())).toBe("next"); expect(await documentStep(page.mainFrame())).toBe("next"); expect(await documentStep(page.mainFrame())).toBe("last");
  expect(await chapterConfirmedComplete(page)).toBe(false);
});
it("下一栏目只点击可用的原生入口，锁定栏目保留", async () => {
  await page.goto(`${origin}/mycourse/studentstudy?chapterId=1`);
  await page.setContent('<ul id="prev_tab"><li id="dct1" class="active">1</li><li id="dct2" class="disabled" onclick="document.body.dataset.clicked=\'yes\';document.getElementById(\'dct1\').classList.remove(\'active\');this.classList.add(\'active\')">2</li></ul>');
  expect(await nextNativeTab(page)).toBe(false); await page.locator("#dct2").evaluate(n => n.classList.remove("disabled"));
  expect(await nextNativeTab(page)).toBe(true); expect(await page.locator("body").getAttribute("data-clicked")).toBe("yes");
});

it("隐藏的完成模板不当成提交成功，题目仍需读取", async () => {
  await page.goto(`${origin}/mycourse/studentstudy?chapterId=1`);
  await page.locator("body").evaluate(n => { const marker = document.createElement("div"); marker.dataset.quizCompleted = "true"; marker.hidden = true; n.append(marker); });
  expect(await readQuestions(page.mainFrame())).toHaveLength(1);
});

it("嵌套确认弹层关闭后立即核对结果，不再读取消失的内层弹窗", async () => {
  await page.goto(`${origin}/mycourse/studentstudy?chapterId=1`);
  page.setDefaultTimeout(800);
  await page.locator('button').evaluate(button => {
    button.onclick = () => {
      document.body.dataset.submissions = String(Number(document.body.dataset.submissions || 0) + 1);
      document.body.insertAdjacentHTML('beforeend', `<div id="workpop"><div class="popDiv">确认提交答案？<a id="popok">提交</a></div></div>`);
      document.getElementById('popok')!.onclick = () => {
        document.body.dataset.confirmations = String(Number(document.body.dataset.confirmations || 0) + 1);
        document.getElementById('workpop')!.remove();
        document.body.insertAdjacentHTML('beforeend', '<span class="testTit_status">已提交</span>');
      };
    };
  });
  const questions = await readQuestions(page.mainFrame());
  await applyAnswers(page, page.mainFrame(), questions, [['2']], page.url());
  await expect(submitChapter(page, page.mainFrame(), page.url(), questions)).resolves.toBeUndefined();
  expect(await page.locator('body').getAttribute('data-submissions')).toBe('1');
  expect(await page.locator('body').getAttribute('data-confirmations')).toBe('1');
});

it.each([true, false])('父页面嵌套确认框只确认一次，明确结果=%s', async (acknowledged) => {
  await page.goto(`${origin}/mycourse/studentstudy?chapterId=1`);
  page.setDefaultTimeout(800);
  await page.setContent(`<iframe src="${origin}/work/quiz"></iframe>`);
  const frame = await page.locator('iframe').contentFrame().locator('button').elementHandle().then(handle => handle!.ownerFrame());
  const questions = await readQuestions(frame!);
  await frame!.locator('button').evaluate((button, ack) => {
    button.onclick = () => {
      document.body.dataset.submissions = String(Number(document.body.dataset.submissions || 0) + 1);
      parent.document.body.insertAdjacentHTML('beforeend', '<div id="workpop"><div class="popDiv">确认提交答案？<a id="popok">提交</a></div></div>');
      parent.document.getElementById('popok')!.onclick = () => {
        document.body.dataset.confirmations = String(Number(document.body.dataset.confirmations || 0) + 1);
        parent.document.getElementById('workpop')!.remove();
        if (ack) setTimeout(() => document.body.insertAdjacentHTML('beforeend', '<span class="testTit_status">已提交</span>'), 150);
      };
    };
  }, acknowledged);
  await applyAnswers(page, frame!, questions, [['2']], page.url());
  const submission = submitChapter(page, frame!, page.url(), questions);
  if (acknowledged) await expect(submission).resolves.toBeUndefined();
  else await expect(submission).rejects.toThrow('平台完成状态尚未确认');
  expect(await frame!.locator('body').getAttribute('data-submissions')).toBe('1');
  expect(await frame!.locator('body').getAttribute('data-confirmations')).toBe('1');
}, 10000);
