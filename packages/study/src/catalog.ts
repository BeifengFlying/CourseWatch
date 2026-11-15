import type { Page } from 'playwright';
import type { CourseRecord } from '../../contracts/src/index.js';
import { readUpstreamCatalog } from './upstream-catalog.js';
import type { CourseLearningProgress } from '../../contracts/src/study.js';
import { courseDeadline } from '../../contracts/src/course-deadline.js';
import { readStudyChapters } from './chapter-directory.js';
import { openChaoxingDirectory } from './launch.js';
import { openUnipusStudy } from './unipus-launch.js';
import { StudyError } from './errors.js';
import { DiagnosticError } from '../../core/src/diagnostics.js';
// Read rendered official labels only. A local timer, played video or visited
// chapter never becomes an official completion value.
export async function readCourseCatalog(page: Page, course: Pick<CourseRecord,'id'|'name'|'platform'>): Promise<CourseLearningProgress> {
  const value: CourseLearningProgress = { courseId: course.id, name: course.name, completed: null, total: null, percent: null, chapters: [], observedAt: Date.now() };
  if (course.platform === 'unipus') {
    const matches = page.getByText(course.name, { exact:true }).filter({visible:true});
    if (await matches.count() !== 1) throw new Error('教程名称未找到或存在同名项，进度待确认');
    const card = await matches.evaluate(n => {
      let root: Element | null = n;
      while (root && !/已学任务\s*[：:]\s*\d+\s*\/\s*\d+/.test(root.textContent || '')) root=root.parentElement;
      const content=(root?.textContent || '').replace(/\s+/g,' ').trim();
      if ((content.match(/已学任务/g)||[]).length !== 1) return null;
      let group=root;
      while (group && !/课程名称\s*[：:]/.test(group.textContent || '')) group=group.parentElement;
      const groupText=(group?.textContent || '').replace(/\s+/g,' ').trim();
      return { content, groupText: (groupText.match(/课程名称/g)||[]).length === 1 ? groupText : '' };
    });
    if (!card) throw new Error('官网教程进度结构无法识别，旧进度已保留');
    const count=card.content.match(/已学任务\s*[：:]\s*(\d+)\s*\/\s*(\d+)/), percent=card.content.match(/学习进度\s*[：:]\s*(\d+(?:\.\d+)?)\s*%/);
    if (count && Number(count[1])<=Number(count[2])) {value.completed=Number(count[1]);value.total=Number(count[2]);}
    if (percent && Number(percent[1])<=100) value.percent=Number(percent[1]);
    const period=card.groupText.match(/计分周期\s*[：:]\s*20\d{2}[-/]\d{1,2}[-/]\d{1,2}\s*(?:—|–|~|至|-)\s*(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
    value.deadline=courseDeadline(period?.[1]);value.deadlineLabel='计分截止';
    value.group=card.groupText.match(/课程名称\s*[：:]\s*(.+?)(?:班级名称|计分周期|在学教程|$)/)?.[1]?.trim().slice(0,300);
    value.className=card.groupText.match(/班级名称\s*[：:]\s*(.+?)(?:计分周期|在学教程|$)/)?.[1]?.trim().slice(0,300);
  } else {
    for (const frame of page.frames()) {
      if (!/^https:\/\/(?:i|mooc\d+(?:-[\w-]+)?)\.chaoxing\.com(?:\/|$)/.test(frame.url())) continue;
      const snapshot=await frame.evaluate(()=>{
        const body=(document.body?.innerText || '').replace(/\s+/g,' ');
        const count=body.match(/已完成任务点\s*[：:]\s*(\d+)\s*\/\s*(\d+)/);
        const chapters=[...document.querySelectorAll('.posCatalog_select[id^="cur"],h4[id^="cur"],.chapter_item[id^="cur"],.chapter-item')].filter(n=>!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden').slice(0,400).map(row=>{
          const name=(row.querySelector('.posCatalog_name,.chapter-name,.chapter-title,.catalog_name')?.textContent||row.getAttribute('title')||'').replace(/\s+/g,' ').trim().slice(0,300);
          const status=(row.querySelector('.catalog_points,.task-status,.catalog_task')?.textContent || '').trim();
          const complete=row.getAttribute('data-completed')==='true'||[...row.querySelectorAll('.icon_Completed,.icon-complete,.icon_yiwanc,.icon_yiwancheng')].some(n=>!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden') ? true : row.getAttribute('data-completed')==='false'||[...row.querySelectorAll('.icon_Uncompleted')].some(n=>!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden') ? false : /^(已完成|任务点已完成)$/.test(status)?true:/^(未完成|任务点未完成)$/.test(status)?false:null;
          const pending=(row.textContent||'').match(/(?:未完成|剩余)\s*(\d+)\s*个?任务点/) || (row.querySelector('.bntHoverTips')?.textContent||'').match(/(\d+)\s*个待完成任务点/);
          return {name,complete:complete ?? (pending && Number(pending[1]) > 0 ? false : null),...(pending?{pending:Number(pending[1])}:{})};
        }).filter(c=>c.name);
        return {count:count?[Number(count[1]),Number(count[2])]:null,chapters};
      });
      if (snapshot.count && snapshot.count[0]<=snapshot.count[1]) {value.completed=snapshot.count[0];value.total=snapshot.count[1];}
      const upstream = await readUpstreamCatalog(frame);
      if (upstream.length) value.chapters = upstream;
      else if(snapshot.chapters.length)value.chapters=snapshot.chapters;
    }
  }
  if (course.platform === 'chaoxing') {
    const chapters = await readStudyChapters(page, 'chaoxing');
    if (chapters.length) value.chapters = chapters.map(({id,name,complete,locked,path}, index) => {
      const original = value.chapters.find(c => c.name === name) || (value.chapters.length === chapters.length ? value.chapters[index] : undefined);
      return {...original,id,name:original?.name || name,complete:original?.complete ?? complete,locked,...(path ? {path} : {})};
    });
  }
  if(value.completed===null&&value.percent===null&&!value.chapters.length) throw new Error('尚未识别到官网进度，旧进度已保留');
  value.observedAt=Date.now();return value;
}

// The course landing page loads the directory in an iframe after DOMContentLoaded.
// Wait for recognizable read-only data instead of relying on a fixed sleep.
export async function waitForCourseCatalog(page: Page, course: Pick<CourseRecord,'id'|'name'|'platform'>, timeout = 12000): Promise<CourseLearningProgress> {
  if (course.platform === 'chaoxing') await openChaoxingDirectory(page, timeout);
  const deadline = Date.now() + timeout;
  do {
    try { return await readCourseCatalog(page, course); }
    catch (error) {
      if (page.isClosed() || Date.now() >= deadline) throw error;
      if (await page.locator('input[type=password]').filter({visible:true}).count()) throw new Error('登录已失效，请重新登录');
    }
    await page.waitForTimeout(300);
  } while (true);
}

// Card totals do not contain chapter entries. Follow the selected book's
// official navigation and wait for its content directory, including popups.
// The catalog worker blocks media playback before opening these pages.
export async function readUnipusCourseCatalog(page: Page, course: Pick<CourseRecord,'id'|'name'|'platform'>, timeout = 12000): Promise<CourseLearningProgress> {
  let step = 'read-card-progress';
  try {
    const progress = await waitForCourseCatalog(page, course, timeout);
    step = 'open-book';
    const book = page.getByText(course.name, {exact:true}).filter({visible:true});
    if (await book.count() !== 1) throw new StudyError('官网教程入口未找到或存在同名项，请重新同步课程后重试');
    await book.click({timeout:5000});
    step = 'open-content';
    const content = await openUnipusStudy(page, course.name, timeout);
    step = 'read-chapter-directory';
    const deadline = Date.now() + timeout;
    do {
      const chapters = await readStudyChapters(content, 'unipus');
      if (chapters.length) {
        progress.chapters = chapters.map(({id,name,complete,locked,path}) => ({id,name,complete,locked,...(path ? {path} : {})}));
        progress.observedAt = Date.now();
        return progress;
      }
      await content.waitForTimeout(300);
    } while (Date.now() < deadline);
    throw new StudyError('U校园教程已打开，但章节目录未加载，请打开官网教程检查后重试');
  } catch (error) {
    throw new StudyError(error instanceof StudyError ? error.message : 'U校园章节目录读取未完成，请检查登录和官网教程后重试', {
      cause:new DiagnosticError('U校园目录查询未完成', 'unipus-catalog', {step}, {cause:error}),
    });
  }
}
