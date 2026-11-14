// Read-only portal 5.0 contracts observed in official frontend bundles on 2026-11-13.
// Aggregation is a dashboard subset, not a complete account snapshot.
import { z } from "zod";
import { createHash } from "node:crypto";
import type { SourceTask } from "../../contracts/src/index.js";
import { CollectionError, CourseScan, parseJson, type ReadPage } from "./course-http.js";
import { parseTime } from "./parser.js";
export const unipusOrigin = "https://uai.unipus.cn";
export const unipusUrls = {
  courses: `${unipusOrigin}/api/cmgt/course/my/bookshelf`,
  homework: `${unipusOrigin}/api/portal/v1/homework/student-aggregation`,
  exams: `${unipusOrigin}/api/portal/v1/exam/student-exams`,
};
const Id = z.union([z.string().min(1).max(180), z.number().int().nonnegative()]).transform(String);
const Text = z.string().min(1).max(300);
function envelope(body: string): any {
  const data = z.object({ code: z.number(), msg: z.string().optional(), message: z.string().optional() }).passthrough().parse(parseJson(body));
  if (data.code !== 1) {
    if ([3008, 3009, 401].includes(data.code) || /登录|过期|token|login/i.test(`${data.msg} ${data.message}`))
      throw new CollectionError("U校园登录已失效，请重新登录", "auth_required", true);
    if (data.code >= 6000) throw new CollectionError("请在 U校园官网检查账号、院校或验证要求", "verification_required", true);
    throw new CollectionError("U校园未返回成功结果，旧任务已保留");
  }
  return data;
}
export function parseUnipusCourses(body: string) {
  const data = z.object({ value: z.object({ groups: z.record(z.string(), z.array(z.object({ resourceId: Id, name: Text })).max(2000)) }) }).parse(envelope(body));
  return [...new Map(Object.values(data.value.groups).flat().map(c => [`resource:${c.resourceId}`, { key: `resource:${c.resourceId}`, name: c.name }])).values()];
}
export function unipusHeaders(state: { origins: { origin: string; localStorage: { name: string; value: string }[] }[] }) {
  const origin = state.origins.find(o => o.origin === unipusOrigin);
  let persistent: any;
  try { persistent = JSON.parse(origin?.localStorage.find(v => v.name === "PORTAL_STATE_PERSISTENT")?.value ?? "{}"); } catch { /* Reject malformed saved state. */ }
  const token = persistent?.tokenInfo?.jwt ?? persistent?.Authorization;
  if (typeof token !== "string" || !token || token.length > 20000 || /[\r\n]/.test(token))
    throw new CollectionError("请在 U校园 AI 版官方窗口登录并保存会话", "auth_required", true);
  const headers: Record<string, string> = { Authorization: token, Referer: `${unipusOrigin}/` };
  // The official portal uses the authenticated token's openId and saved school.
  try {
    const payload = JSON.parse(Buffer.from(token.replace(/^Bearer /i, "").split(".")[1], "base64url").toString());
    if (typeof payload.openId === "string" && /^[\w-]{1,180}$/.test(payload.openId)) headers["u-openid"] = payload.openId;
  } catch { /* Some token formats do not expose an openId. */ }
  if (Number.isSafeInteger(persistent?.schId)) headers["u-school"] = String(persistent.schId);
  return headers;
}
function time(value: unknown): SourceTask["deadline"] {
  if (value === undefined || value === null || value === "") return { kind: "unknown" };
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value < 1e12 ? value * 1000 : value;
    return { kind: "known", value: Math.round(ms), raw: String(value), timezone: "Asia/Shanghai" };
  }
  if (typeof value === "string") {
    if (/^\d{10,13}$/.test(value)) return time(Number(value));
    if (/(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
      const ms = Date.parse(value);
      if (Number.isFinite(ms) && ms > 0) return { kind: "known", value: ms, raw: value.slice(0,120), timezone: "Asia/Shanghai" };
    }
    return parseTime(value);
  }
  return { kind: "unknown" };
}
// SSO detail URLs may carry short-lived credentials; only retain the portal entry.
const Homework = z.object({ assignmentId: Id, platform: z.string().min(1).max(80), title: Text, classes: z.array(z.object({ className: Text })).max(100).optional(), startTime: z.unknown().optional(), endTime: z.unknown().optional(), publishTime: z.unknown().optional(), detailSsoUrl: z.string().optional() });
const Exam = z.object({ examId: Id, examName: Text, examStatus: z.number().optional(), examStartTime: z.unknown().optional(), examEndTime: z.unknown().optional(), examUrl: z.string().optional() });
export function parseUnipusTasks(body: string, type: "homework" | "exam"): { items: SourceTask[]; total: number; issues: string[] } {
  const raw = envelope(body);
  const data = type === "homework"
    ? z.object({ data: z.object({ homework: z.object({ total: z.number().int().nonnegative(), items: z.array(Homework).max(2000), platformStatus: z.record(z.string(), z.unknown()).optional() }) }) }).parse(raw).data.homework
    : z.object({ data: z.object({ totalCount: z.number().int().nonnegative(), items: z.array(Exam).max(2000) }) }).parse(raw).data;
  const items: SourceTask[] = [];
  for (const rawItem of data.items) {
    if (type === "homework") {
      const h = Homework.parse(rawItem);
      // The portal exposes class names, without a proven bookshelf resource relation.
      const groups = h.classes?.length ? [...new Set(h.classes.map(c => c.className))] : [""];
      for (const group of groups) {
        const encoded = encodeURIComponent(group);
        const key = group ? `class:${encoded.length <= 180 ? encoded : createHash("sha256").update(group).digest("hex")}` : "unassigned:homework";
        items.push({ courseKey: key, course: group ? `班级：${group.slice(0, 280)}（未关联教程）` : "作业（未提供课程）", namespace: `${key}:${h.platform}:homework`, sourceId: h.assignmentId, title: h.title,
          type, sourceStatus: "unknown", deadline: time(h.endTime), startTime: time(h.startTime), publishTime: time(h.publishTime),
          url: `${unipusOrigin}/` });
      }
    } else {
      const e = Exam.parse(rawItem), key = "unassigned:exam";
      items.push({ courseKey: key, course: "考试（未提供课程）", namespace: `${key}:exam`, sourceId: e.examId, title: e.examName, type,
        sourceStatus: e.examStatus === 2 ? "in_progress" : "unknown", deadline: time(e.examEndTime), startTime: time(e.examStartTime), publishTime: { kind: "unknown" },
        url: `${unipusOrigin}/` });
    }
  }
  const total = "total" in data ? data.total : data.totalCount;
  return { items, total, issues: ["官网汇总未证明覆盖全部任务；课程关联和完成状态以官网为准", ...(total > data.items.length ? ["官网汇总仅返回部分任务，旧记录已保留"] : [])] };
}
export async function collectUnipus(read: ReadPage, accountId: string, headers: Record<string,string>, selected?: string[]) {
  const scan = new CourseScan("unipus", accountId);
  try {
    scan.result.courses = parseUnipusCourses(await read(unipusUrls.courses, headers));
    const types = [["homework", unipusUrls.homework], ["exam", unipusUrls.exams]] as const;
    for (const [type, url] of types) {
      await scan.partition(`unipus:${type}`, async () => {
        const data = parseUnipusTasks(await read(url, headers), type);
        for (const task of data.items) {
          if (!scan.result.courses!.some(c => c.key === task.courseKey)) scan.result.courses!.push({ key: task.courseKey!, name: task.course });
        }
        return { items: data.items.filter(t => selected?.includes(t.courseKey!)), paginationComplete: false, emptyConfirmed: false, issues: data.issues };
      });
    }
  } catch (error) { scan.fail(error); }
  return scan.finish();
}
