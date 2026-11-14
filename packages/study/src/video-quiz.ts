// 严禁删除：用户要求保留学习通视频选择弹题穷举、反馈确认及取消保护。
// 受 study-protection.json 和 verify-study-protection.mjs 校验；修改须同步保护清单和行为测试。
import type { Page } from 'playwright';
import { officialStudyFrame, studyPageKind } from '../../contracts/src/study.js';
import { assertPageAllowed } from './page.js';
import { visibleFrame } from './visible-frame.js';

export const videoQuizRoots = '.ans-videoquiz,.video-question,.quiz-overlay,[data-video-quiz],[data-video-quiz-root],.tkTopic:not(.ans-videoquiz .tkTopic)';
const feedbackSelector = '[data-video-quiz-result],.videoquiz-result,.videoquiz-feedback,.answer-feedback,.tkTopic_oper .rightInfo,.tkTopic_oper .spanNot,.tkTopic_oper .spanNotBack';
interface Attempt { next: number; pending: boolean; passed: boolean; }
export type VideoQuizAttempts = Map<string, Attempt>;

// Enumerate only the choices in a video popup. Chapter quizzes and homework
// keep their separate submission policy. An ambiguous click never earns a retry.
export async function solveVideoQuizzes(page: Page, attempts: VideoQuizAttempts, signal: AbortSignal, log: (text: string) => void): Promise<boolean> {
  const expectedURL = page.url();
  const guard = async () => {
    signal.throwIfAborted();
    if (page.url() !== expectedURL || studyPageKind(page.url()) !== 'chapter') throw new Error('视频弹题页面已变化，已暂停');
    await assertPageAllowed(page, true);
    signal.throwIfAborted();
  };
  await guard();
  let handled = false;
  for (const frame of page.frames().filter(f => officialStudyFrame(f.url()))) {
    if (!await visibleFrame(frame)) continue;
    const roots = frame.locator(videoQuizRoots).filter({ visible: true });
    if (!await roots.count()) continue;
    if (await roots.count() !== 1) throw new Error('视频弹题无法唯一定位，请手动处理');
    const root = roots.first(), frameURL = frame.url();
    const read = () => root.evaluate(node => {
      const visible = (n: Element) => !!n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
      const clean = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const nodes = [...node.querySelectorAll('.tkItem,.singleQuesId,.TiMu,.question-item,[data-questionid],fieldset')].filter(visible);
      const leaves = nodes.filter(n => !nodes.some(other => other !== n && n.contains(other)));
      const questions = (leaves.length ? leaves : [node]).map((n, index) => {
        n.setAttribute('data-coursewatch-video-question', String(index));
        const controls = [...n.querySelectorAll<HTMLInputElement>('input[type=radio],input[type=checkbox]')];
        const stem = clean(n.querySelector('.tkItem_title,.Zy_TItle,.question-title,.stem,legend,h3,h4')?.textContent);
        return { stem, types: controls.map(c => c.type), options: controls.map(c => clean((c.labels?.[0] || c.closest('li,label'))?.textContent || c.getAttribute('aria-label'))) };
      });
      const holder = node.closest('.video-js,.prism-player,[data-video-player],.ans-attach-ct') || document;
      const videos = [...holder.querySelectorAll<HTMLVideoElement>('video')].filter(visible);
      return { questions, video: videos.length === 1 ? videos[0].id || videos[0].currentSrc || 'video' : null, target: node.getAttribute('data-video-id'), id: node.id, cue: node.getAttribute('data-cue-seconds') };
    });
    const snapshot = await read();
    if (!snapshot.video || snapshot.target && snapshot.target !== snapshot.video) throw new Error('无法确认视频弹题所属播放器，请手动处理');
    const choices: number[][][] = snapshot.questions.map(q => {
      if (!q.stem || q.options.length < 2 || q.options.length > 8 || q.options.some(o => !o) || new Set(q.types).size !== 1) throw new Error('视频弹题仅支持完整的单选、判断或多选控件，请手动处理');
      return q.types[0] === 'checkbox' ? Array.from({ length: 2 ** q.options.length - 1 }, (_, i) => q.options.flatMap((_, j) => (i + 1) & 2 ** j ? [j] : [])) : q.options.map((_, i) => [i]);
    });
    if (choices.reduce((total, options) => total * options.length, 1) > 256) throw new Error('视频弹题选项组合超过 256 种，请手动处理');
    const combinations = choices.reduce<number[][][]>((all, options) => all.flatMap(prefix => options.map(option => [...prefix, option])), [[]]);
    if (combinations.length > 256) throw new Error('视频弹题选项组合超过 256 种，请手动处理');
    const key = JSON.stringify([expectedURL, frameURL, snapshot]);
    const record = attempts.get(key) || { next: 0, pending: false, passed: false };
    attempts.set(key, record);
    const check = async () => {
      await guard();
      if (frame.isDetached() || frame.url() !== frameURL || JSON.stringify(await read()) !== JSON.stringify(snapshot)) throw new Error('视频弹题内容已变化，已暂停');
    };
    const resume = async () => {
      const button = root.locator('#videoquiz-continue,.ans-videoquiz-continue,[data-video-quiz-continue],.videoquiz-continue').filter({ visible: true });
      if (await button.count() === 1 && await button.isEnabled()) { await check(); await button.click({ timeout: 3000 }); }
      if (await root.isVisible()) throw new Error('视频弹题结果已确认，但弹层尚未关闭，请手动处理后继续');
      await frame.locator('video,audio').evaluateAll(nodes => nodes.forEach(n => delete (n as HTMLElement).dataset.coursewatchPlayed));
    };
    if (record.pending) throw new Error('视频弹题上次提交结果未确认，请手动核实，不重复提交');
    if (record.passed) { await resume(); handled = true; continue; }
    while (record.next < combinations.length) {
      await check();
      const selected = combinations[record.next];
      for (const [i, answer] of selected.entries()) {
        const controls = root.locator(`[data-coursewatch-video-question="${i}"]`).locator('input[type=radio],input[type=checkbox]');
        for (let j = 0; j < snapshot.questions[i].options.length; j++) {
          await check();
          if (snapshot.questions[i].types[j] === 'radio' && !answer.includes(j)) continue;
          await controls.nth(j).setChecked(answer.includes(j), { force: true, timeout: 3000 });
        }
        for (let j = 0; j < snapshot.questions[i].options.length; j++) if (await controls.nth(j).isChecked() !== answer.includes(j)) throw new Error('视频弹题选项回读不一致，未提交');
      }
      const button = root.locator('#videoquiz-submit,[data-video-quiz-submit]').filter({ visible: true });
      if (await button.count() !== 1 || !await button.isEnabled()) throw new Error('视频弹题提交按钮不可用，请手动处理');
      await check();
      // Observe fresh feedback, including identical text written after a retry.
      await root.evaluate((n, selector) => {
        const state = { version: 0, observer: new MutationObserver(records => {
          if (records.some(r => { const element = r.target.nodeType === 1 ? r.target as Element : r.target.parentElement; return !!element?.closest(selector) || [...r.addedNodes].some(n => n instanceof Element && (n.matches(selector) || !!n.querySelector(selector))); })) state.version++;
        }) };
        (n as any).__coursewatchFeedback?.observer.disconnect();
        (n as any).__coursewatchFeedback = state;
        state.observer.observe(n, { subtree: true, childList: true, characterData: true, attributes: true });
      }, feedbackSelector);
      record.pending = true; record.next++;
      log(`视频弹题：尝试第 ${record.next}／${combinations.length} 组选项`);
      try {
        signal.throwIfAborted();
        await button.click({ timeout: 3000 });
        let outcome = '';
        for (let i = 0; i < 16; i++) {
          await guard();
          if (frame.isDetached() || frame.url() !== frameURL) throw new Error('视频弹题提交后页面变化，结果待核实');
          if (!await root.isVisible()) { outcome = 'released'; break; }
          await check();
          const feedback = await root.evaluate((n, selector) => {
            if (!(n as any).__coursewatchFeedback?.version) return '';
            return [...n.querySelectorAll(selector)].filter(n => !!n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden').map(n => n.textContent).join('；');
          }, feedbackSelector);
          const wrong = /错误|不正确|答错|真遗憾|再接再厉/.test(feedback), right = /回答正确|作答正确|答案正确|答题正确|答对|回答成功/.test(feedback);
          if (wrong && !right) { outcome = /回看|重新观看|重看/.test(feedback) ? 'replay' : 'wrong'; break; }
          if (right && !wrong) { outcome = 'passed'; break; }
          await page.waitForTimeout(250);
        }
        if (!outcome) throw new Error('视频弹题提交结果未确认，已暂停，不重复提交');
        record.pending = false;
        if (outcome === 'passed' || outcome === 'released') {
          record.passed = true;
          if (outcome === 'passed') await resume();
          else await frame.locator('video,audio').evaluateAll(nodes => nodes.forEach(n => delete (n as HTMLElement).dataset.coursewatchPlayed));
          log(outcome === 'passed' ? '视频弹题已回答正确，继续播放' : '平台已关闭视频弹题，继续检查播放');
          handled = true; break;
        }
        if (outcome === 'replay') throw new Error('视频弹题回答错误，平台要求回看；请完成回看后继续，已保留下组选项');
      } finally {
        await root.evaluate(n => { (n as any).__coursewatchFeedback?.observer.disconnect(); delete (n as any).__coursewatchFeedback; }, undefined, { timeout: 100 }).catch(() => {});
      }
    }
    if (!record.passed) throw new Error('视频弹题所有选项组合已尝试，仍未通过，请手动核实');
  }
  return handled;
}
