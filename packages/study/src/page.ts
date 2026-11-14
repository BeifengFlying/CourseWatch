import type { Frame, Page, Dialog } from "playwright";
import { officialStudyFrame, studyPageKind, type StudyQuestion } from "../../contracts/src/study.js";
import { visibleFrame } from './visible-frame.js';
import { readQuestionFontMaps } from './question-font.js';

// Page selectors were compared with zhu-hailin/chaoxing-ai-assistant (MIT),
// 0d91475bfdf39c8e51031d96f0d658827aefd887. Font decoding uses pinned local
// Typr and glyph mappings; the upstream userscript is never injected.
export const questionRoots = ".singleQuesId,.TiMu,.question-item[data-question-id],[data-questionid]";
export async function chapterQuizComplete(frame: Frame) {
  if (!await visibleFrame(frame)) return false;
  return frame.locator('[data-quiz-completed=true],.ans-work-finished,.work-finished,.testTit_status,[data-quiz-status]').evaluateAll(nodes => nodes.some(n => {
    if (!n.getClientRects().length || getComputedStyle(n).visibility === 'hidden') return false;
    if (n.matches('[data-quiz-completed=true],.ans-work-finished,.work-finished')) return true;
    return /^(已完成|已提交|提交成功)(?:[·|：:、,，]?(?:最终成绩|成绩|得分)?[（(]?\d+(?:\.\d+)?分[）)]?)?$/.test((n.textContent || '').replace(/\s/g,''));
  }));
}
export async function readQuestions(frame: Frame, decodeFonts = true): Promise<StudyQuestion[]> {
  if (!await visibleFrame(frame) || await chapterQuizComplete(frame)) return [];
  const fonts = decodeFonts ? await readQuestionFontMaps(frame, questionRoots) : [];
  return frame.evaluate(({selector, fonts, decodeFonts}) => {
    const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
    const visible = (e: Element) => !!e.getClientRects().length && getComputedStyle(e).visibility !== "hidden";
    const text = (root: Element | null | undefined, omitOptionLabel = false) => {
      if (!root) return '';
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), parts: string[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        // The legacy site marks its visible option UL aria-hidden for its
        // separate screen-reader controls. Its rendered option text is needed.
        if (!parent || parent.closest('script,style,noscript,template,[hidden],[aria-hidden=true]:not(ul.Zy_ulTop)') || !visible(parent) || getComputedStyle(parent).fontSize === '0px'
          || omitOptionLabel && parent.closest('.num_option,.num_option_dx')) continue;
        let hidden = false;
        for (let element: Element | null = parent; element; element = element.parentElement) {
          if (getComputedStyle(element).opacity === '0') { hidden = true; break; }
        }
        if (hidden) continue;
        let value = node.textContent || '';
        if (decodeFonts && /(?:^|,)\s*["']?font-cxsecret["']?\s*(?:,|$)/i.test(getComputedStyle(parent).fontFamily)) {
          value = value.replace(/[\u3400-\u9fff\ue000-\ufaff]/g, char => {
            const code = char.codePointAt(0)!;
            const face = fonts.find(f => f.ranges.some(([from, to]) => code >= from && code <= to));
            if (!face && fonts.length) return char; // Outside every declared font range: native fallback.
            const decoded = face?.characters[String(code)];
            if (decoded === undefined) throw new Error('题干或选项字体发生变化，未调用模型或提交；请重新读取');
            return decoded;
          });
        }
        if (decodeFonts && /[\ufffd\ue000-\uf8ff]/.test(value)) throw new Error('题干或选项仍含无法识别的字符，未调用模型或提交，请在官网核对');
        parts.push(value);
      }
      return clean(parts.join(''));
    };
    if ([...document.querySelectorAll("[data-quiz-completed=true],.ans-work-finished,.work-finished")].some(visible)) return [];
    return [...document.querySelectorAll(selector)].filter(n => visible(n) && !n.parentElement?.closest(selector)
      && !n.closest('.ans-videoquiz,.video-question,.quiz-overlay,[data-video-quiz],[data-video-quiz-root],.tkTopic')
      && !n.closest('[role=dialog],form')?.querySelector('#videoquiz-submit')).map((node, index) => {
      node.setAttribute("data-coursewatch-question", String(index));
      const heading = node.querySelector(".Zy_TItle,.mark_name,.question-title,.stem,.mark_title,[data-question-stem]");
      const stem = text(heading || node.querySelector("h3,h4"));
      const inputs = [...node.querySelectorAll<HTMLInputElement>('input[type="radio"],input[type="checkbox"]')];
      const custom = [...node.querySelectorAll('.answerBg,.Zy_ulTop li,.answerList li,.answer-list li,ul li')].filter(n => visible(n) && !n.querySelector('.answerBg') && (n.querySelector('.num_option,.num_option_dx') || n.matches('li.before-after,li.before-after-checkbox') && n.querySelector('label.before') && n.querySelector('a.after')));
      custom.forEach((row, i) => row.setAttribute('data-coursewatch-option', String(i)));
      const rows = custom.length ? custom : [...node.querySelectorAll(".Zy_ulTop li,.answerList li,.answer-list li,[data-option],label")].filter(visible);
      const options = inputs.length ? inputs.map(input => {
        const row = input.closest('.answerBg,li,[data-option]');
        const content = row?.querySelector('.answer_p,a.after,.option-content');
        const label = input.labels?.[0] || row || input.closest('label');
        return content ? text(content) : text(label) || text(row, true) || clean(input.getAttribute("aria-label"));
      }) : rows.map(row => {
        const content = row.querySelector('.answer_p,a.after,.option-content');
        return text(content || row, !content);
      });
      const fields = [...node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('textarea,input[type="text"],input:not([type]),[contenteditable="true"]')].filter(n => visible(n) && !n.hasAttribute("readonly") && !n.hasAttribute("disabled"));
      const type = /多选/.test(stem) || inputs.some(n => n.type === "checkbox") || !!node.querySelector(".num_option_dx") ? "multiple" : /判断/.test(stem) ? "judge" : inputs.length || rows.length || /单选/.test(stem) ? "single" : /填空/.test(stem) || fields.length > 1 ? "blank" : "text";
      const id = node.getAttribute("data-questionid") || node.getAttribute("data-question-id") || node.getAttribute("data") || node.id || String(index);
      return { id, stem: stem.slice(0, 16000), type, options, slots: ["single", "multiple", "judge"].includes(type) ? 1 : fields.length };
    });
  }, { selector: questionRoots, fonts, decodeFonts });
}
export async function assertPageAllowed(page: Page, allowVideoQuiz = false) {
  const kind = studyPageKind(page.url());
  if (kind === "exam") throw new Error("已暂停：考试页面不在自动学习范围内");
  if (kind === "login") throw new Error("登录已失效，请在官方窗口登录后继续");
  if (!["chapter", "homework"].includes(kind)) return false;
  for (const frame of page.frames().filter(f => officialStudyFrame(f.url()))) {
    const blocked = await frame.locator('.geetest_panel,.yidun_popup,[data-captcha],.captcha-container,.face-recognition,[data-face-verification]').evaluateAll(nodes => nodes.some(n => !!n.getClientRects().length && getComputedStyle(n).visibility !== "hidden"));
    if (!allowVideoQuiz && await frame.locator('.ans-videoquiz:visible,.video-question:visible,.quiz-overlay:visible,[data-video-quiz]:visible,[data-video-quiz-root]:visible').count()) throw new Error("视频出现弹题，已暂停，请手动处理后继续");
    if (blocked) throw new Error("平台要求人脸或验证码验证，请在官方窗口处理后继续");
  }
  return true;
}
export async function applyAnswers(page: Page, frame: Frame, before: StudyQuestion[], answers: string[][], expectedURL: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (page.url() !== expectedURL || studyPageKind(page.url()) !== "chapter" || !officialStudyFrame(frame.url())) throw new Error("页面发生变化，未填入或提交");
  if (JSON.stringify(await readQuestions(frame)) !== JSON.stringify(before)) throw new Error("题目发生变化，未填入或提交");
  for (let i = 0; i < before.length; i++) {
    signal?.throwIfAborted();
    await assertPageAllowed(page);
    if (page.url() !== expectedURL) throw new Error("章节发生变化，未提交");
    const q = before[i], root = frame.locator(`[data-coursewatch-question="${i}"]`);
    if (["single", "multiple", "judge"].includes(q.type)) {
      const controls = root.locator('input[type="radio"],input[type="checkbox"]');
      if (!await controls.count()) {
        const rows = root.locator('[data-coursewatch-option]');
        if (await rows.count() !== q.options.length) throw new Error('该选择控件尚未适配，未提交');
        const bindings = await rows.evaluateAll((nodes,type) => {
          const legacyLabels=nodes.filter(n=>n.matches('li.before-after,li.before-after-checkbox')).map(n=>n.querySelector('label.before')?.textContent?.trim());
          return new Set(legacyLabels).size===legacyLabels.length && nodes.every(n => {
          if (!n.matches('li.before-after,li.before-after-checkbox')) return true;
          const handler=n.getAttribute('onclick') || '', labels=n.querySelectorAll(':scope > label.before'), content=n.querySelectorAll(':scope > a.after');
          const mode=type==='multiple'?'addMultipleChoice':'addChoice';
          return labels.length===1 && content.length===1 && /^[A-Z]$/.test((labels[0].textContent || '').trim()) && new RegExp('^\\s*(?:return\\s+)?'+mode+'\\(\\s*this\\s*\\)\\s*;?\\s*$').test(handler);
          });
        },q.type);
        if (!bindings) throw new Error('选项原生点击事件无法确认，未填入或提交');
        const selected = (index: number) => rows.nth(index).evaluate(n => n.matches('[aria-checked=true],[aria-pressed=true],.on,.active,.checked,.selected,.check_answer,.check_answer_dx') || !!n.querySelector('.check_answer,.check_answer_dx,.num_option.check,.num_option.checked,.num_option.on,label.before.on,label.before.active,label.before.checked,label.before.selected,[aria-checked=true],[aria-pressed=true]'));
        for (let j = 0; j < q.options.length; j++) {
          const wanted = answers[i].includes(String(j + 1));
          if (q.type !== 'multiple' && !wanted) continue;
          if (await selected(j) !== wanted) {
            signal?.throwIfAborted(); await assertPageAllowed(page);
            await rows.nth(j).click({timeout:5000});
          }
        }
        for (let j = 0; j < q.options.length; j++) if (await selected(j) !== answers[i].includes(String(j + 1))) throw new Error('选项回读不一致，未提交');
        // Some templates keep the native saved value outside the question.
        // Native handlers can save asynchronously. Wait for their actual value;
        // never write the hidden field ourselves or click the answer again.
        let saved = false;
        for (let attempt = 0; attempt < 21; attempt++) {
          signal?.throwIfAborted();
          await assertPageAllowed(page);
          if (page.url() !== expectedURL) throw new Error('章节发生变化，未提交');
          saved = await root.evaluate((node, { wanted, qid }) => {
            const id = node.getAttribute('data-questionid') || node.getAttribute('data-question-id') || node.getAttribute('data') || node.id.replace(/^question/,'') || qid;
            // The legacy template also has answertype<qid>. Prefix matching
            // mistakes that metadata for a second answer and blocks submission.
            const fields = [...document.querySelectorAll<HTMLInputElement>('input[type=hidden]')].filter(n => n.id === 'answer' + id || n.name === 'answer' + id);
            if (fields.length > 1) return false;
            const field = fields[0];
            if (!field) return true;
            if (field.closest('.singleQuesId,.TiMu,.question-item[data-question-id],[data-questionid]') && !node.contains(field)) return false;
            const values = [...node.querySelectorAll('[data-coursewatch-option]')].filter((_, index) => wanted.includes(String(index + 1))).map(row => {
              const marker = row.querySelector('.num_option,.num_option_dx');
              return marker?.getAttribute('data')?.trim() || row.querySelector('label.before')?.textContent?.trim() || marker?.textContent?.trim() || '';
            });
            if (values.some(v => !v) || new Set(values).size !== values.length) return false;
            const actual = field.value.trim();
            return actual === values.join('') || actual.split(/[,;，；|\s]+/).filter(Boolean).sort().join('|') === values.sort().join('|');
          }, { wanted: answers[i], qid: q.id });
          if (saved) break;
          if (attempt < 20) await page.waitForTimeout(100);
        }
        if (!saved) throw new Error('官网答案字段尚未保存，未提交');
        if (JSON.stringify(await readQuestions(frame)) !== JSON.stringify(before)) throw new Error('题目发生变化，未提交');
        for (let j = 0; j < q.options.length; j++) if (await selected(j) !== answers[i].includes(String(j + 1))) throw new Error('选项回读不一致，未提交');
        continue;
      }
      if (await controls.count() !== q.options.length) throw new Error("该选择控件尚未适配，未提交");
      for (let j = 0; j < q.options.length; j++) {
        const wanted = answers[i].includes(String(j + 1)), input = controls.nth(j);
        if (q.type !== "multiple" && !wanted) continue;
        signal?.throwIfAborted();
        await input.setChecked(wanted, { force: true, timeout: 5000 });
      }
      for (let j = 0; j < q.options.length; j++) if (await controls.nth(j).isChecked() !== answers[i].includes(String(j + 1))) throw new Error("选项回读不一致，未提交");
    } else {
      const fields = root.locator('textarea:visible,input[type="text"]:visible,input:not([type]):visible,[contenteditable="true"]:visible');
      if (await fields.count() !== q.slots) throw new Error("输入框发生变化，未提交");
      for (let j = 0; j < q.slots; j++) {
        const field = fields.nth(j); signal?.throwIfAborted(); await field.fill(answers[i][j], { timeout: 5000 });
        const actual = await field.evaluate((n: any) => "value" in n ? n.value : n.textContent);
        if ((actual || "").trim() !== answers[i][j].trim()) throw new Error("答案回读不一致，未提交");
      }
    }
  }
}
export async function submitChapter(page: Page, frame: Frame, expectedURL: string, before: StudyQuestion[], signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (page.url() !== expectedURL || studyPageKind(page.url()) !== "chapter") throw new Error("只有当前章节测验可以自动提交");
  await assertPageAllowed(page);
  if (JSON.stringify(await readQuestions(frame)) !== JSON.stringify(before)) throw new Error("提交前题目发生变化，已暂停");
  const buttons = frame.locator('button:visible,input[type="submit"]:visible,a:visible').filter({ hasText: /^\s*(提交|提交答案|提交测验)\s*$/ });
  const inputButton = frame.locator('input[type="submit"][value="提交"]:visible');
  const button = await buttons.count() === 1 ? buttons : inputButton;
  if (await button.count() !== 1) throw new Error("没有识别到唯一的章节提交按钮，请手动处理");
  signal?.throwIfAborted();
  if (page.url() !== expectedURL || !officialStudyFrame(frame.url())) throw new Error("提交前页面发生变化，已暂停");
  const nativeDialog = (dialog: Dialog) => {
    const confirm = dialog.type() === "confirm" && /提交/.test(dialog.message()) && !/考试|人脸|验证|未答|漏答|未完成/.test(dialog.message()) && page.url() === expectedURL && !signal?.aborted;
    void (confirm ? dialog.accept() : dialog.dismiss()).catch(() => {});
  };
  page.on("dialog", nativeDialog);
  try {
  await button.click({ timeout: 5000 });
  // Only inspect the current quiz and its ancestor dialogs, not sibling tasks.
  const ancestors: Frame[] = [];
  for (let current: Frame | null = frame; current; current = current.parentFrame()) ancestors.push(current);
  let confirmed = false;
  // A click is never treated as proof of completion.
  for (let attempt = 0; attempt < 12; attempt++) {
    signal?.throwIfAborted();
    if (page.isClosed() || frame.isDetached() || page.url() !== expectedURL) throw new Error("提交后页面变化，结果待核实，请在平台检查后继续");
    if (await chapterQuizComplete(frame)) return;
    if (await frame.getByText(/^(提交成功|已提交|测验已完成)$/).filter({ visible: true }).count()) return;
  confirmationDialogs: for (const ancestor of confirmed ? [] : ancestors.filter(f => officialStudyFrame(f.url()))) {
    signal?.throwIfAborted();
    if (page.url() !== expectedURL) break;
    const dialogs = ancestor.locator('[role="dialog"]:visible,.layui-layer:visible,#workpop:visible,.popDiv:visible');
    for (const dialog of await dialogs.all()) {
      const text = await dialog.innerText();
      if (!/提交/.test(text) || /人脸|验证|考试|未答|漏答|未完成/.test(text)) continue;
      const confirm = dialog.locator('button,a,input[type="button"],input[type="submit"]').filter({visible:true}).filter({hasText:/^\s*(确定|确认|确认提交|提交)\s*$/});
      if (await confirm.count() === 1 && !signal?.aborted) {
        confirmed = true;
        await confirm.click({ timeout: 5000 });
        // #workpop contains .popDiv in the native template. Confirming removes
        // both: do not resolve another nth() from the now-stale visible list.
        // Later polls only observe the result and never click confirmation again.
        break confirmationDialogs;
      }
    }
  }
    if (await chapterQuizComplete(frame)) return;
    if (await frame.getByText(/^(提交成功|已提交|测验已完成)$/).filter({ visible: true }).count()) return;
    await page.waitForTimeout(500);
  }
  throw new Error("已点击提交，但平台完成状态尚未确认；请核实后继续，程序不会重复提交");
  } finally { page.off("dialog", nativeDialog); }
}
export async function mediaTick(frame: Frame): Promise<{ kind: string; progress?: number }> {
  if (!await visibleFrame(frame)) return { kind: "none" };
  return frame.evaluate(() => {
    const videos = [...document.querySelectorAll<HTMLMediaElement>("video,audio")].filter(v => !!v.getClientRects().length && getComputedStyle(v).visibility !== 'hidden');
    const video = videos.find(v => !v.ended);
    if (!video) return { kind: videos.length ? "ended" : "none" };
    if (video.error) return { kind: "error" };
    video.playbackRate = 1; video.muted = true;
    if (video.paused) {
      if (video.dataset.coursewatchPlayed === "true") return { kind: "error" };
      video.dataset.coursewatchPlayed = "true";
      void video.play().catch(() => {});
    }
    video.dataset.coursewatchPlayed = "true";
    return { kind: "playing", progress: video.currentTime };
  });
}
export async function pauseMedia(page: Page) {
  for (const frame of page.frames().filter(f => officialStudyFrame(f.url()))) await frame.locator("video,audio").evaluateAll(nodes => nodes.forEach(n => (n as HTMLMediaElement).pause())).catch(() => {});
}
export async function documentStep(frame: Frame, advance = true): Promise<"none" | "next" | "last" | "unknown"> {
  if (!await visibleFrame(frame)) return "none";
  const marker = frame.locator('#viewerContainer,.pdfViewer,[data-document-reader],.swiper-container,.swiper,#img.imglook').filter({visible:true});
  if (!await marker.count()) return "none";
  const counter = frame.locator('#pageNumber:visible,input[aria-label="页码"]:visible,[data-slide-current]:visible').first();
  const totalNode = frame.locator('#numPages,[data-slide-total],.total-pages').first();
  if (await counter.count() && await totalNode.count()) {
    const totalText = await totalNode.getAttribute("data-slide-total") || await totalNode.innerText();
    const total = Number(totalText.match(/\d+/)?.[0]);
    const current = Number(await counter.evaluate((n: any) => n.value || n.getAttribute("data-slide-current") || n.textContent));
    if (Number.isInteger(total) && total > 0 && total < 100000 && current > 0) {
      if (current >= total) return "last";
      const next = frame.locator('#next:visible,[data-slide-next]:visible,button[aria-label="下一页"]:visible').first();
      if (await next.count() && await next.isEnabled()) { if (advance) await next.click(); return "next"; }
    }
  }
  const nextSlide = frame.locator('.swiper-button-next:visible:not(.swiper-button-disabled)');
  if (await nextSlide.count() === 1) { if (advance) await nextSlide.click(); return "next"; }
  if (await frame.locator('.swiper-slide-active:last-child').count()) return "last";
  // Continuous documents are scrolled incrementally so lazy pages can render.
  const result = await marker.first().evaluate((root, advance) => {
    const element = root as HTMLElement;
    const scroll = element.scrollHeight > element.clientHeight + 4 ? element : document.scrollingElement as HTMLElement | null;
    if (!scroll) return "unknown";
    const pages = root.querySelectorAll('.page,img[src]');
    if (!pages.length) return "unknown";
    if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 4) return "last";
    if (advance) scroll.scrollTop += Math.max(200, scroll.clientHeight * .8); return "next";
  }, advance);
  return result as "next" | "last" | "unknown";
}
export async function nextNativePage(page: Page, signal?: AbortSignal): Promise<boolean> {
  if (studyPageKind(page.url()) !== "chapter") return false;
  // Native chapter tabs are tried before the next chapter.
  for (const frame of page.frames().filter(f => officialStudyFrame(f.url()))) {
    const button = frame.getByRole("button", { name: /^下一页$/ });
    const link = frame.getByRole("link", { name: /^下一页$/ });
    const candidate = await button.count() === 1 ? button : link;
    if (await candidate.count() === 1 && await candidate.isVisible() && await candidate.isEnabled() && await candidate.getAttribute("aria-disabled") !== "true") { signal?.throwIfAborted(); await candidate.click(); return true; }
  }
  const { switchStudyItem } = await import('./navigation.js');
  return switchStudyItem(page, 'chaoxing', 'next', signal);
}
export async function chapterConfirmedComplete(page: Page) {
  const { readStudyChapters } = await import('./chapter-directory.js');
  const current = (await readStudyChapters(page, 'chaoxing')).filter(c => c.current);
  return current.length === 1 && current[0].complete === true;
}

export async function nextNativeTab(page: Page, signal?: AbortSignal) {
  if (studyPageKind(page.url()) !== "chapter") return false;
  const target = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>('#prev_tab li[id^="dct"],#prev_tab [data-course-tab]')];
    const active = nodes.filter(n => n.classList.contains("active") || n.getAttribute("aria-selected") === "true");
    if (active.length !== 1 || new Set(nodes.map(n => n.id)).size !== nodes.length) return null;
    const next = nodes[nodes.indexOf(active[0]) + 1];
    return next && /^dct\d+$/.test(next.id) && next.getAttribute("aria-disabled") !== "true" && !next.classList.contains("disabled") ? next.id : null;
  });
  if (!target) return false;
  return selectNativeTab(page, target, signal);
}
export async function selectNativeTab(page: Page, target: string, signal?: AbortSignal) {
  if (!/^dct\d+$/.test(target) || !await assertPageAllowed(page, true)) return false;
  const tab = page.locator(`#prev_tab [id="${target}"]`);
  if (await tab.count() !== 1 || !await tab.isVisible() || !await tab.isEnabled() || await tab.evaluate(n => n.matches('.disabled,[aria-disabled=true]'))) return false;
  const state = () => page.evaluate(() => {
    const cards = document.querySelector<HTMLIFrameElement>('#mainid #iframe');
    let url = '';
    try { url = cards?.contentDocument?.URL || ''; } catch { /* Wait for a readable official card. */ }
    return {tab:document.querySelector('#prev_tab .active,#prev_tab [aria-selected=true]')?.id, cards:!!cards, url};
  });
  const before = await state();
  if (before.tab === target) return true;
  signal?.throwIfAborted(); await tab.click({timeout:5000});
  for (let i = 0; i < 40; i++) {
    signal?.throwIfAborted(); await page.waitForTimeout(250);
    if (!await assertPageAllowed(page, true)) return false;
    const after = await state();
    if (after.tab === target && (!after.cards || after.url && after.url !== 'about:blank' && after.url !== before.url)) return true;
  }
  return false;
}
export async function documentProgress(frame: Frame) {
  return frame.evaluate(() => JSON.stringify({
    page: (document.querySelector('#pageNumber,input[aria-label="页码"]') as HTMLInputElement)?.value || document.querySelector('[data-slide-current]')?.getAttribute("data-slide-current"),
    slide: [...document.querySelectorAll('.swiper-slide')].findIndex(n => n.classList.contains('swiper-slide-active')),
    scroll: [...document.querySelectorAll<HTMLElement>('#viewerContainer,.pdfViewer,[data-document-reader],#img.imglook')].map(n => [n.scrollTop, n.scrollHeight]),
    body: document.scrollingElement?.scrollTop,
  }));
}
