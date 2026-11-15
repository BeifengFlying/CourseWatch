import { z } from "zod";
export const STUDY_NOTICE_VERSION = "2026-11-15.1";
export const UNIPUS_STUDY_NOTICE_VERSION = "2026-11-15.u1";
export const STUDY_ACCEPTANCE_TEXT = "已阅读并理解用途、自动操作、数据发送及保留说明；仅用于技术实现验证与参考，不用于其他目的。超出该范围使用的后果由使用者依法承担，法律规定不能免除的责任不受影响。";
export type StudyPlatform = "chaoxing" | "unipus";
export const studyPlatformNames = { chaoxing: "学习通", unipus: "U校园" } as const;
export const studyNoticeVersion = (platform: StudyPlatform) => platform === "unipus" ? UNIPUS_STUDY_NOTICE_VERSION : STUDY_NOTICE_VERSION;
export const ModelEndpoint = z.string().trim().max(1000).transform((value, ctx) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    url.pathname = url.pathname.replace(/\/(chat\/completions|models)\/?$/i, '');
    return url.href.replace(/\/+$/, "");
  } catch { ctx.addIssue({ code: "custom", message: "请填写 HTTPS API 地址，不含凭据或查询参数" }); return z.NEVER; }
});
export const StudyConfig = z.object({
  enabled: z.boolean().default(false),
  noticeVersion: z.union([z.literal(STUDY_NOTICE_VERSION), z.literal(UNIPUS_STUDY_NOTICE_VERSION)]).nullable().default(null),
  baseURL: ModelEndpoint.default("https://api.deepseek.com"),
  model: z.string().trim().max(200).default(""),
  images: z.boolean().default(false),
  questionLimit: z.number().int().min(1).max(200).default(30),
  pageSeconds: z.number().int().min(2).max(60).default(3),
  playMedia: z.boolean().default(true),
  answerExercises: z.boolean().default(false),
  chapterTests: z.boolean().default(true),
  autoSubmitPractice: z.boolean().default(false),
  localSkills: z.boolean().default(false),
  targetMinutes: z.number().int().min(0).max(1440).default(0),
});
export type StudyConfig = z.infer<typeof StudyConfig>;
export const StudyConfigInput = StudyConfig.extend({
  apiKey: z.string().trim().max(4096).refine(s => !/[\s\x00-\x1f\x7f]/.test(s)).optional(),
  localSkillsAccepted: z.literal(true).optional(),
});
export const StudyStart = z.object({
  operation: z.enum(["play", "answers", "keep-open"]).default("play"),
  courseId: z.string().max(100).optional(),
  chapterId: z.string().min(1).max(200).optional(),
  task: z.enum(["video", "quiz"]).optional(),
  background: z.boolean().default(false),
  closeAfterMinutes: z.number().int().min(0).max(1440).default(0),
}).strict().refine(v => v.operation !== "keep-open" || v.closeAfterMinutes > 0, { message: "请设置页面关闭时间" });
export type StudyStart = z.infer<typeof StudyStart>;
export interface StudyChapterPath { id: string; name: string; }
export interface StudyTask { id: string; tabId?: string; name: string; kind: "video" | "quiz" | "document" | "other"; complete: boolean | null; current: boolean; locked?: boolean; }
export interface StudyChapterEntry { tasks?: StudyTask[]; id?: string; name: string; complete: boolean | null; pending?: number; locked?: boolean; path?: StudyChapterPath[]; }
export interface CourseLearningProgress {
  courseId: string; name: string; group?: string; className?: string;
  completed: number | null; total: number | null; percent: number | null;
  chapters: StudyChapterEntry[];
  observedAt: number;
  deadline?: string | null;
  deadlineLabel?: string;
}
export type StudyPhase = "idle" | "starting" | "running" | "paused" | "stopping" | "stopped" | "failed" | "completed";
export interface StudyQuestion { id: string; stem: string; type: "single" | "multiple" | "judge" | "blank" | "text"; options: string[]; slots: number; }
export interface StudyAnswer { id: string; stem: string; answers: string[]; explanation: string; mode: "chapter" | "homework" | "practice"; options?: string[]; }
export interface StudyProgress {
  observedAt: number; course: string; chapter: string; chapterComplete: boolean | null;
  chapterId?: string; tabId?: string; courseKey?: string; tasks?: StudyTask[];
  chapters: StudyChapterEntry[];
  media: { kind: "video" | "audio"; current: number; duration: number | null; paused: boolean; ended: boolean }[];
  documents: { current: number | null; total: number | null }[];
}
export interface StudyPosition { chapterId: string; chapter: string; tabId?: string; observedAt: number; }
export interface StudyStatus {
  phase: StudyPhase; message: string; startedAt: number | null; requests: number;
  inputTokens: number; outputTokens: number; answers: StudyAnswer[];
  logs: { at: number; message: string }[];
  progress: StudyProgress | null;
  modelActivity?: { question: number; total: number; phase: "requesting" | "thinking" | "answering" | "completed" | "interrupted"; reasoning: string; answer: string; updatedAt: number };
  operation?: StudyStart["operation"]; closeAt?: number | null; heartbeatAt?: number;
  courseName?: string;
  navigation?: { previous: boolean; next: boolean };
  timing?: { mediaSeconds: number; readingSeconds: number; targetSeconds: number };
}
export function initialStudyStatus(): StudyStatus {
  return { phase: "idle", message: "尚未启动", startedAt: null, requests: 0, inputTokens: 0, outputTokens: 0, answers: [], logs: [], progress: null };
}
export function studyPageKind(value: string): "chapter" | "homework" | "exam" | "login" | "other" {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port || !/^(?:i|passport2|mooc[1-9]\d*(?:-[a-z0-9]+)*)\.(?:chaoxing|xuexitong)\.com$/.test(u.hostname)) return "other";
    const p = decodeURIComponent(u.pathname).toLowerCase();
    if (/exam|test\/retest/.test(p)) return "exam";
    if (/login|passport/.test(p) || u.hostname.startsWith("passport")) return "login";
    if (/\/(?:mooc-ans\/)?mycourse\/studentstudy\/?$/.test(p)) return "chapter";
    if (/\/(?:mooc-ans\/)?work\/(?:dohomeworknew|dohomework|dowork)\/?$/.test(p)) return "homework";
  } catch { /* Unknown pages never qualify for automated writing. */ }
  return "other";
}
export function officialStudyFrame(value: string) {
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && !u.port && /^(?:[a-z0-9-]+\.)?(?:chaoxing|xuexitong)\.com$/.test(u.hostname) && !/exam|login/i.test(decodeURIComponent(u.pathname)); } catch { return false; }
}
export function validateStudyAnswer(question: StudyQuestion, value: unknown): { answers: string[]; explanation: string } {
  const result = z.object({ answers: z.array(z.string().trim().min(1).max(12000)).min(1).max(30), explanation: z.string().max(12000).default("") }).parse(value);
  const choices = ["single", "multiple", "judge"].includes(question.type);
  if (choices) {
    if ((question.type !== "multiple" && result.answers.length !== 1) || new Set(result.answers).size !== result.answers.length || result.answers.some(a => !/^[1-9]\d*$/.test(a) || Number(a) > question.options.length)) throw new Error("模型选项与题目不匹配，未填入或提交");
  } else if (result.answers.length !== question.slots) throw new Error("模型答案数量与输入框不匹配，未填入或提交");
  return result;
}

// The portal and course content are separate origins. Authentication and tests
// are deliberately excluded from the content allowlist.
export function unipusPageKind(value: string): "study" | "exam" | "login" | "other" {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return "other";
    if (u.hostname === "sso.unipus.cn") return "login";
    if (u.hostname === "itest.unipus.cn") return "exam";
    if (!["uai.unipus.cn", "ucontent.unipus.cn"].includes(u.hostname)) return "other";
    const route = decodeURIComponent(`${u.pathname}${u.search}${u.hash}`).toLowerCase();
    if (/(?:exam|assessment|placement|testpaper|考试|测评)/.test(route)) return "exam";
    // "lesson" contains "sso"; only an actual login route qualifies.
    if (/(?:^|[/?#=&])(?:login|passport|sso)(?:[/?#=&._-]|$)/.test(route)) return "login";
    return u.hostname === "ucontent.unipus.cn" ? "study" : "other";
  } catch { return "other"; }
}
export function unipusStudyFrame(value: string) { return unipusPageKind(value) === "study"; }
