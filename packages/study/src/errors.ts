import { BrowserUnavailableError } from "../../adapters/src/browser.js";
// Only our own actionable errors can be shown verbatim. Browser errors can
// contain authenticated URLs, filesystem paths and page content.
export class StudyError extends Error {}
export type StudyFailureStage = "questions" | "model" | "fill" | "submit" | 'settings' | 'session' | 'browser' | 'course' | 'running';
export function studyFailureMessage(error: unknown, stage: StudyFailureStage): string {
  if (error instanceof BrowserUnavailableError) return error.message;
  if (error instanceof StudyError) return error.message;
  const message = error instanceof Error ? error.message : '';
  if (stage === 'session') return message === 'no session' ? '未保存平台登录，请先在平台设置中登录' : '无法读取本机登录信息，请重新登录平台';
  if (stage === 'settings') return '学习设置不完整，请检查实验开关及当前操作所需的模型配置';
  if (stage === 'browser') return /Executable doesn't exist|executable.*not.*exist/i.test(message) ? '找不到所选浏览器，请安装 Chrome／Edge 或在设置中切换浏览器' : '浏览器未能启动，请关闭残留的学习窗口后重试';
  if (stage === 'course') return error instanceof Error && error.name === 'TimeoutError' ? '官网课程或章节加载超时，请在官方窗口检查网络、登录和访问限制后重试' : '无法打开所选课程的章节，请在官方窗口检查登录、验证提示或章节访问限制';
  if (stage === 'questions') return '题目读取未完成，已暂停；请在官方窗口检查题目是否加载完整';
  if (stage === 'model') return '模型请求未完成，已暂停；请检查模型服务及网络后继续';
  if (stage === 'fill') return '答案填入或回读未完成，尚未提交；请在官方窗口检查选项和输入框后继续';
  if (stage === 'submit') return '提交操作或结果确认未完成，已暂停；请在官网核实是否已提交，程序不会重复提交';
  return '学习页面运行中断，请打开官方窗口核对页面后重试';
}
