import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { unipusPageKind } from "../packages/contracts/src/study.js";
import { unipusFrames, readUnipusQuestions, applyUnipusAnswers, submitUnipusPractice, nextUnipusItem, readUnipusProgress, playUnipusMedia } from "../packages/study/src/unipus-page.js";
let browser: Browser, page: Page;
const url = "https://ucontent.unipus.cn/course/#/practice/1";
const fixture = `<h1 class="unit-title">Unit 1</h1><div class="course-name">模拟教程</div><span class="task-status">未完成</span>
<div class="question-item" data-question-id="one"><h3>Choose B</h3><label><input type="radio" name="one">A</label><label><input type="radio" name="one">B</label></div>
<div class="question-item"><h3>填空</h3><input type="text"></div>
<button onclick="if(confirm('Submit answers?')){document.body.dataset.submissions=String(1+Number(document.body.dataset.submissions||0));this.insertAdjacentHTML('afterend','<p>提交成功</p>')}">提交练习</button><button disabled>下一项</button>`;
beforeAll(async () => { browser = await chromium.launch({ channel: "chromium", headless: true }); });
afterAll(async () => { await browser.close(); });
beforeEach(async () => { page = await browser.newPage(); await page.route("**/*", r => r.fulfill({ contentType: "text/html; charset=utf-8", body: fixture })); await page.goto(url); });
afterEach(async () => { await page.close(); });
it("仅允许明确内容源，SPA 考试和登录不进入学习流程", () => {
  expect(unipusPageKind(url)).toBe("study");
  for (const s of ["https://ucontent.unipus.cn/#/exam/1", "https://ucontent.unipus.cn/?type=assessment", "https://itest.unipus.cn/"]) expect(unipusPageKind(s)).toBe("exam");
  for (const s of ["https://ucontent.unipus.cn.evil.test/", "http://ucontent.unipus.cn/", "https://u:p@ucontent.unipus.cn/"]) expect(unipusPageKind(s)).toBe("other");
});
it("识别练习、原生填写回读，明确提交结果只提交一次", async () => {
  const frame = page.mainFrame(), qs = await readUnipusQuestions(frame), signal = new AbortController().signal;
  expect(qs).toHaveLength(2); expect(qs[0].options).toEqual(["A", "B"]);
  await applyUnipusAnswers(page, frame, qs, [["2"], ["word"]], url, signal);
  expect(await page.locator('input[type="radio"]').nth(1).isChecked()).toBe(true);
  expect(await page.locator('input[type="text"]').inputValue()).toBe("word");
  await submitUnipusPractice(page, frame, qs, url, signal);
  await expect(submitUnipusPractice(page, frame, qs, url, signal)).rejects.toThrow("不重复提交");
  expect(await page.locator('body').getAttribute('data-submissions')).toBe("1");
});
it("课程作业和考试禁止写入，人工确认弹窗停止操作", async () => {
  const qs = await readUnipusQuestions(page.mainFrame()), signal = new AbortController().signal;
  await page.goto("https://ucontent.unipus.cn/course/#/assignment/1");
  await expect(applyUnipusAnswers(page, page.mainFrame(), qs, [["2"], ["word"]], page.url(), signal)).rejects.toThrow("未填入");
  await page.goto("https://ucontent.unipus.cn/course/#/exam/1"); await expect(unipusFrames(page)).rejects.toThrow("考试");
  await page.goto(url); await page.locator('body').evaluate(n => n.insertAdjacentHTML('beforeend','<div role="dialog">长时间未操作，请确认继续学习</div>'));
  await expect(unipusFrames(page)).rejects.toThrow("本人确认");
});
it("嵌入考试、题目变化、无效模型答案和取消均不能填入", async () => {
  const qs = await readUnipusQuestions(page.mainFrame()), signal = new AbortController().signal;
  await expect(applyUnipusAnswers(page, page.mainFrame(), qs, [["9"], ["word"]], url, signal)).rejects.toThrow("不匹配");
  await page.locator('h3').first().evaluate(n => n.textContent = 'Changed');
  await expect(applyUnipusAnswers(page, page.mainFrame(), qs, [["2"], ["word"]], url, signal)).rejects.toThrow("变化");
  const abort = new AbortController(); abort.abort(); await expect(submitUnipusPractice(page, page.mainFrame(), qs, url, abort.signal)).rejects.toThrow();
  await page.locator('body').evaluate(n => n.insertAdjacentHTML('beforeend','<iframe src="https://itest.unipus.cn/"></iframe>'));
  await page.locator('iframe').waitFor(); await page.waitForTimeout(100);
  await expect(unipusFrames(page)).rejects.toThrow("考试");
});
it("查询不推算完成，下一项必须可用，媒体练习共存时暂停", async () => {
  const result = await readUnipusProgress(page); expect(result.progress).toMatchObject({ course: "模拟教程", chapter: "Unit 1", chapterComplete: false, chapters: [] });
  expect(await nextUnipusItem(page)).toBe(false);
  await page.getByRole('button', { name: '下一项', exact: true }).evaluate(n => { (n as HTMLButtonElement).disabled = false; n.setAttribute('onclick', "document.body.dataset.next='yes'"); });
  expect(await nextUnipusItem(page)).toBe(true);
  await page.locator('body').evaluate(n => n.insertAdjacentHTML('beforeend','<video controls width="320" height="180"></video>'));
  await expect(playUnipusMedia(page)).rejects.toThrow("出现练习");
});
it("提交结果不明确时保留待核实状态", async () => {
  await page.getByRole('button', { name: '提交练习' }).evaluate(n => n.removeAttribute('onclick'));
  await expect(submitUnipusPractice(page, page.mainFrame(), await readUnipusQuestions(page.mainFrame()), url, new AbortController().signal)).rejects.toThrow("结果未确认");
}, 15000);
it("播放仅调用正常播放器，恢复 1 倍速，不改播放位置或调用上报", async () => {
  await page.setContent('<video controls width="320" height="180"></video>');
  await page.locator('video').evaluate(n => {
    const m = n as HTMLVideoElement;
    Object.defineProperties(m, { currentTime: { value: 42, writable: true }, paused: { value: true, configurable: true }, ended: { value: false }, readyState: { value: 4 }, duration: { value: 180 } });
    m.playbackRate = 2;
    m.play = async () => { Object.defineProperty(m, 'paused', { value: false, configurable: true }); m.dataset.playCalled = 'yes'; };
  });
  expect(await playUnipusMedia(page)).toBe('playing');
  expect(await page.locator('video').evaluate(n => ({ current: (n as HTMLVideoElement).currentTime, rate: (n as HTMLVideoElement).playbackRate, played: (n as HTMLElement).dataset.playCalled }))).toEqual({ current: 42, rate: 1, played: 'yes' });
  const snapshot = await readUnipusProgress(page);
  expect(snapshot.progress?.media[0]).toMatchObject({ current: 42, duration: 180, paused: false });
  expect(JSON.stringify(snapshot.progress)).not.toContain('ucontent.unipus.cn');
});
it("父页面作业标记和样式锁定的下一项保留人工处理", async () => {
  await page.goto('https://ucontent.unipus.cn/course/?type=homework');
  await expect(applyUnipusAnswers(page, page.mainFrame(), await readUnipusQuestions(page.mainFrame()), [['2'], ['word']], page.url(), new AbortController().signal)).rejects.toThrow('未填入');
  await page.goto(url);
  await page.getByRole('button', { name: '下一项' }).evaluate(n => { (n as HTMLButtonElement).disabled = false; n.classList.add('locked'); });
  expect(await nextUnipusItem(page)).toBe(false);
});
