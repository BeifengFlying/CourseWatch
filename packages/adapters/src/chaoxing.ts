// Read-only endpoints and list selectors adapted from siye4366/xxt-Tool,
// commit 92e8870e9678b878de0b44ca964496a6a6a8e313, XtApi.kt / HtmlParsers.kt (MIT).
// Attribution and full license: THIRD_PARTY_NOTICES.md.
import { load } from "cheerio";
import { courseDeadline } from "../../contracts/src/course-deadline.js";
import { z } from "zod";
import {
  safePlatformReadUrl,
  type SourceTask,
} from "../../contracts/src/index.js";
import { parseTime } from "./parser.js";
import {
  CollectionError,
  CourseScan,
  parseJson,
  type ReadPage,
} from "./course-http.js";
import { inspectSession } from "./session.js";

export const chaoxingCoursesUrl =
  "https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json&getTchClazzType=1&mcode=";
export const chaoxingWebCoursesUrl = "https://mooc2-ans.chaoxing.com/visit/interaction";
const Id = z
  .union([
    z
      .string()
      .regex(/^[\w-]+$/)
      .max(120),
    z.number().int().nonnegative(),
  ])
  .transform(String);
const Named = z.object({ id: Id, name: z.string().max(300) });
const CourseContent = z.object({
  id: Id,
  endDate: z.unknown().optional(),
  name: z.string().max(300).optional(),
  course: z.object({ data: z.array(Named).max(2000) }).optional(),
  clazz: z
    .array(z.object({ id: Id }))
    .max(2000)
    .optional(),
});
export interface ChaoxingCourse {
  courseId: string;
  classId: string;
  name: string;
  deadline?: string;
}
export function parseChaoxingCourses(body: string): ChaoxingCourse[] {
  const value = parseJson(body);
  const status = z
    .object({
      result: z.union([z.number(), z.boolean()]),
      msg: z.string().optional(),
      errorMsg: z.string().optional(),
    })
    .passthrough()
    .parse(value);
  if (status.result !== 1 && status.result !== true) {
    const message = `${status.msg ?? ""} ${status.errorMsg ?? ""}`;
    if (/登录|login/i.test(message))
      throw new CollectionError(
        "学习通登录已失效，请重新登录",
        "auth_required",
        true,
      );
    throw new CollectionError("学习通课程接口未返回成功结果");
  }
  const list = z
    .object({
      channelList: z.array(z.object({ content: z.unknown() })).max(2000),
    })
    .parse(value).channelList;
  const courses: ChaoxingCourse[] = [];
  for (const entry of list) {
    const c = CourseContent.parse(
      typeof entry.content === "string"
        ? parseJson(entry.content)
        : entry.content,
    );
    if (c.course)
      for (const course of c.course.data)
        courses.push({ courseId: course.id, classId: c.id, name: course.name, ...(courseDeadline(c.endDate) ? { deadline: courseDeadline(c.endDate)! } : {}) });
    else if (c.clazz)
      for (const clazz of c.clazz)
        courses.push({
          courseId: c.id,
          classId: clazz.id,
          name: c.name || "未命名课程",
          ...(courseDeadline(c.endDate) ? { deadline: courseDeadline(c.endDate)! } : {}),
        });
    else throw new CollectionError("学习通课程结构无法识别，旧任务已保留");
  }
  return [
    ...new Map(courses.map((c) => [`${c.courseId}:${c.classId}`, c])).values(),
  ];
}
// Read the protected web list when the mobile API cannot use a web session.
// Require native student cards with matching course/class IDs; a public shell,
// logout label, cookie or unloaded empty container is not login evidence.
export function parseChaoxingWebCourses(html: string): ChaoxingCourse[] {
  checkPage(html);
  const $ = load(html);
  $("script,style,noscript,[hidden],[aria-hidden=true]").remove();
  $("[style]").each((_, el) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(el).attr("style") ?? "")) $(el).remove();
  });
  const cards = $("#courseList").length === 1 && $("#courselistArea").length === 1
    ? $("#courselistArea .course.learnCourse") : $([]);
  const courses: ChaoxingCourse[] = [];
  for (const el of cards.toArray()) {
    const card = $(el), links = card.find("h3 a[href]");
    const name = links.text().trim();
    if (links.length !== 1 || !name || name.length > 300)
      throw new CollectionError("学习通网页课程结构无法识别，旧任务已保留");
    let url: URL;
    try { url = new URL(links.attr("href")!, chaoxingWebCoursesUrl); }
    catch { throw new CollectionError("学习通网页课程入口无法识别，旧任务已保留"); }
    const entries = [...url.searchParams].map(([k, v]) => [k.toLowerCase(), v] as const);
    const params = new Map(entries);
    const courseId = params.get("courseid") ?? "", classId = params.get("clazzid") ?? "";
    if (!safePlatformReadUrl("chaoxing", url.href) || url.pathname !== "/visit/stucoursemiddle" || params.size !== entries.length ||
        !/^\d+$/.test(courseId) || !/^\d+$/.test(classId) || courseId.length > 120 || classId.length > 120 ||
        card.attr("id") !== `c_${courseId}` || !card.hasClass(`stu_${classId}`))
      throw new CollectionError("学习通网页课程入口无法识别，旧任务已保留");
    courses.push({ courseId, classId, name });
  }
  if (!courses.length || courses.length > 2000)
    throw new CollectionError("学习通网页课程列表尚未加载或结构无法识别，旧任务已保留");
  return [...new Map(courses.map(c => [`${c.courseId}:${c.classId}`, c])).values()];
}
export async function readChaoxingCourses(read: ReadPage): Promise<ChaoxingCourse[]> {
  try {
    return parseChaoxingCourses(await read(chaoxingCoursesUrl));
  } catch (error) {
    if (error instanceof CollectionError && (error.outcome === "verification_required" || (error.stop && error.outcome !== "auth_required"))) throw error;
    try {
      return parseChaoxingWebCourses(await read(chaoxingWebCoursesUrl));
    } catch (webError) {
      if (webError instanceof CollectionError && (webError.stop || webError.outcome !== "failed")) throw webError;
      // A web parsing/network failure cannot establish that web login expired.
      if (error instanceof CollectionError && error.outcome === "auth_required") throw webError;
      throw error;
    }
  }
}
export function chaoxingListUrl(c: ChaoxingCourse, type: "homework" | "exam") {
  return `https://mooc1-api.chaoxing.com/phone/moocAnalysis/${type === "homework" ? "workList" : "examList"}?courseId=${encodeURIComponent(c.courseId)}&classId=${encodeURIComponent(c.classId)}`;
}
export function chaoxingTaskUrl(raw: string, type: "homework" | "exam") {
  try {
    const url = new URL(raw, "https://mooc1-api.chaoxing.com/");
    const path =
      type === "homework" ? "work/phone/task-work" : "exam/phone/task-exam";
    if (
      !safePlatformReadUrl("chaoxing", url.href) ||
      ![
        "mooc1-api.chaoxing.com",
        "mooc1.chaoxing.com",
        "mooc2-ans.chaoxing.com",
      ].includes(url.hostname) ||
      !new RegExp(`^/(?:mooc-ans/)?${path}/?$`).test(url.pathname)
    )
      return undefined;
    url.hash = "";
    return url;
  } catch {
    return undefined;
  }
}
function checkPage(html: string) {
  const session = inspectSession(html, "chaoxing");
  if (session.verification)
    throw new CollectionError(
      "学习通要求人工验证",
      "verification_required",
      true,
    );
  if (session.login)
    throw new CollectionError(
      "学习通登录已失效，请重新登录",
      "auth_required",
      true,
    );
}
export function parseChaoxingList(
  html: string,
  c: ChaoxingCourse,
  type: "homework" | "exam",
) {
  checkPage(html);
  const $ = load(html);
  $("script,style,noscript,[hidden],[aria-hidden=true]").remove();
  const issues: string[] = [];
  const items: SourceTask[] = [];
  $(type === "homework" ? "dt[data]" : "tr[data]").each((_, el) => {
    const n = $(el);
    const title = (
      type === "homework"
        ? n.find("h3").text()
        : n.attr("title") || n.find("td").first().text()
    ).trim();
    const url = chaoxingTaskUrl(n.attr("data") ?? "", type);
    const params = url
      ? new Map([...url.searchParams].map(([k, v]) => [k.toLowerCase(), v]))
      : undefined;
    const id =
      params?.get(type === "homework" ? "workid" : "examid") ||
      params?.get("id");
    if (!title || !id || id.length > 300 || !url) {
      issues.push("存在缺少任务 ID、标题或官方入口的条目，已跳过");
      return;
    }
    const status = n.attr("status");
    items.push({
      courseKey: `course:${c.courseId}:class:${c.classId}`,
      sourceId: id,
      namespace: `course:${c.courseId}:class:${c.classId}:${type}`,
      title: title.slice(0, 500),
      course: c.name,
      type,
      sourceStatus:
        ({ "1": "pending", "3": "submitted", "4": "graded" } as const)[
          status as "1" | "3" | "4"
        ] ?? "unknown",
      deadline: { kind: "unknown" },
      startTime: { kind: "unknown" },
      publishTime:
        type === "homework"
          ? parseTime(n.find("p").first().text())
          : { kind: "unknown" },
      url: url.href,
    });
  });
  const unique = [...new Map(items.map((t) => [t.sourceId, t])).values()];
  if (unique.length > 2000) issues.push("列表任务超过本轮数量上限");
  const emptyConfirmed =
    !issues.length &&
    !items.length &&
    /暂无作业|暂无考试|暂无任务|没有作业|没有考试/.test($("body").text());
  if (!unique.length && !emptyConfirmed)
    issues.push("未识别到任务或明确的空列表，旧任务已保留");
  return {
    items: unique.slice(0, 2000),
    emptyConfirmed,
    paginationComplete: false,
    issues: [...new Set(issues)],
  };
}
export function parseChaoxingTimes(html: string) {
  checkPage(html);
  const $ = load(html);
  $("script,style,noscript,[hidden],[aria-hidden=true]").remove();
  const text = $("body").text().replace(/\s+/g, " ");
  const field = (label: string) =>
    parseTime(
      text.match(
        new RegExp(
          `(?:${label})[：:\\s]*((?:20\\d{2})[-/.年]\\d{1,2}[-/.月]\\d{1,2}日?[ T\\s]+\\d{1,2}:\\d{2}(?::\\d{2})?|无截止时间|不限|长期有效)`,
        ),
      )?.[1] ?? "",
    );
  return { startTime: field("开始时间"), deadline: field("截止时间|结束时间") };
}
export async function collectChaoxing(read: ReadPage, accountId: string, selectedCourseKeys?: string[]) {
  const scan = new CourseScan("chaoxing", accountId);
  try {
    const courses = await readChaoxingCourses(read);
    scan.result.courses = courses.map(c => ({ key: `course:${c.courseId}:class:${c.classId}`, name: c.name }));
    if (!courses.length)
      await scan.partition("courses", async () => ({
        items: [],
        emptyConfirmed: true,
        paginationComplete: false,
        issues: [],
      }));
    for (const c of courses.filter(c => !selectedCourseKeys || selectedCourseKeys.includes(`course:${c.courseId}:class:${c.classId}`)))
      for (const type of ["homework", "exam"] as const) {
        await scan.partition(
          `course:${c.courseId}:class:${c.classId}:${type}`,
          async () => {
            const list = parseChaoxingList(
              await read(chaoxingListUrl(c, type)),
              c,
              type,
            );
            for (const task of list.items) {
              try {
                // Only the read-only landing page is fetched; no answer links or scripts are followed.
                const times = parseChaoxingTimes(await read(task.url!));
                task.startTime = times.startTime;
                task.deadline = times.deadline;
              } catch (error) {
                if (
                  error instanceof CollectionError &&
                  error.outcome !== "failed"
                )
                  throw error;
                if (error instanceof CollectionError && error.stop) {
                  list.issues.push(error.message);
                  error.partial = list;
                  throw error;
                }
                list.issues.push("部分任务时间未读取，未确认的字段保留为未知");
              }
            }
            list.issues = [...new Set(list.issues)].slice(0, 30);
            return list;
          },
        );
      }
  } catch (error) {
    scan.fail(error);
  }
  return scan.finish();
}
