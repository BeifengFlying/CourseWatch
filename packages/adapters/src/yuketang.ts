// Read-only endpoints and response fields adapted from siye4366/xxt-Tool,
// commit 92e8870e9678b878de0b44ca964496a6a6a8e313, YtApi.kt (MIT).
// Attribution and full license: THIRD_PARTY_NOTICES.md.
import { z } from "zod";
import type { SourceTask, SourceConfig } from "../../contracts/src/index.js";
import {
  CollectionError,
  CourseScan,
  parseJson,
  type ReadPage,
} from "./course-http.js";
import { parseTime } from "./parser.js";

const Id = z
  .union([
    z
      .string()
      .regex(/^[\w-]+$/)
      .max(120),
    z.number().int().nonnegative(),
  ])
  .transform(String);
const Course = z.object({
  classroom_id: Id,
  course: z.object({ name: z.string().max(300) }).optional(),
  name: z.string().max(300).optional(),
});
const Courses = z.object({
  data: z.object({ list: z.array(Course).max(2000) }),
});
const Activity = z.object({
  id: Id,
  type: z.number().int(),
  title: z.string().trim().max(500),
  create_time: z.union([z.number(), z.string()]).nullable().optional(),
  deadline: z.union([z.number(), z.string()]).nullable().optional(),
  status: z.number().int().optional(),
  content: z
    .object({
      score_d: z.union([z.number(), z.string()]).nullable().optional(),
    })
    .nullable()
    .optional(),
});
const Activities = z.object({
  data: z.object({ activities: z.array(z.unknown()).max(2000) }),
});
export const rainHosts = ["www.yuketang.cn"] as const;
export function rainOrigin(sources: SourceConfig[]) {
  const host = sources.length ? new URL(sources[0].url).hostname : rainHosts[0];
  if (!(rainHosts as readonly string[]).includes(host))
    throw new CollectionError("请使用普通雨课堂的课程入口");
  return `https://${host}`;
}
function rainJson(body: string) {
  const value = parseJson(body);
  const envelope = z
    .object({
      code: z.union([z.number(), z.string()]).optional(),
      success: z.boolean().optional(),
      msg: z.string().optional(),
      message: z.string().optional(),
    })
    .passthrough()
    .parse(value);
  const message = `${envelope.msg ?? ""} ${envelope.message ?? ""}`;
  if (
    /登录|login|unauthenticated|not authenticated/i.test(message) ||
    [401, -401].includes(Number(envelope.code))
  )
    throw new CollectionError(
      "雨课堂登录已失效，请重新登录",
      "auth_required",
      true,
    );
  if (/验证码|安全验证|captcha/i.test(message))
    throw new CollectionError(
      "雨课堂要求人工验证",
      "verification_required",
      true,
    );
  if (
    (envelope.code !== undefined && Number(envelope.code) !== 0) ||
    envelope.success === false
  )
    throw new CollectionError("雨课堂接口未返回成功结果");
  return value;
}
export function rainTime(raw: unknown): SourceTask["deadline"] {
  if (typeof raw === "string" && !/^\d+(?:\.\d+)?$/.test(raw))
    return parseTime(raw);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return { kind: "unknown" };
  const ms = value < 100000000000 ? value * 1000 : value;
  if (ms < Date.UTC(2000, 0, 1) || ms > Date.UTC(2100, 0, 1))
    return { kind: "unknown" };
  return {
    kind: "known",
    value: Math.trunc(ms),
    raw: String(raw).slice(0, 120),
    timezone: "Asia/Shanghai",
  };
}
export function parseRainCourses(body: string) {
  return Courses.parse(rainJson(body)).data.list;
}
export function parseRainUser(body: string) {
  const data = z
    .object({ data: z.object({ id: Id.optional(), user_id: Id.optional() }) })
    .parse(rainJson(body)).data;
  if (!data.id && !data.user_id)
    throw new CollectionError("尚未确认雨课堂登录身份");
}
export function parseRainActivities(
  body: string,
  classroom: string,
  course: string,
  origin: string,
) {
  const rows = Activities.parse(rainJson(body)).data.activities;
  const items: SourceTask[] = [];
  for (const row of rows) {
    const type = z.object({ type: z.number().int() }).parse(row).type;
    if (type !== 5 && type !== 19) continue;
    const a = Activity.parse(row);
    if (!a.title) throw new CollectionError("雨课堂任务缺少标题");
    items.push({
      courseKey: `classroom:${classroom}`,
      sourceId: a.id,
      namespace: `classroom:${classroom}:activity:${type}`,
      title: a.title,
      course,
      type: type === 19 ? "homework" : "quiz",
      sourceStatus:
        type === 5
          ? (({ 0: "pending", 2: "submitted", 3: "graded" } as const)[
              a.status as 0 | 2 | 3
            ] ?? "unknown")
          : "unknown",
      deadline: rainTime(type === 19 ? a.content?.score_d : a.deadline),
      startTime: { kind: "unknown" },
      publishTime: rainTime(a.create_time),
      url: `${origin}/v2/web/studentLog/${encodeURIComponent(classroom)}`,
    });
  }
  return { items, rowCount: rows.length, fingerprint: JSON.stringify(rows) };
}
export async function collectRain(
  read: ReadPage,
  accountId: string,
  origin: string,
  headers: Record<string, string>,
  selectedCourseKeys?: string[],
) {
  const scan = new CourseScan("yuketang", accountId);
  try {
    parseRainUser(await read(`${origin}/api/v3/user/basic-info`, headers));
    const courses = parseRainCourses(
      await read(`${origin}/v2/api/web/courses/list?identity=2`, headers),
    );
    const unique = [
      ...new Map(courses.map((c) => [c.classroom_id, c])).values(),
    ];
    scan.result.courses = unique.map(c => ({ key: `classroom:${c.classroom_id}`, name: c.course?.name || c.name || "未命名课程" }));
    if (selectedCourseKeys && !unique.some(c => selectedCourseKeys.includes(`classroom:${c.classroom_id}`))) return scan.finish();
    if (!unique.length)
      await scan.partition("courses", async () => ({
        items: [],
        emptyConfirmed: true,
        paginationComplete: false,
        issues: [],
      }));
    for (const c of unique) {
      if (selectedCourseKeys && !selectedCourseKeys.includes(`classroom:${c.classroom_id}`)) continue;
      await scan.partition(
        `classroom:${c.classroom_id}:activities`,
        async () => {
          const items = new Map<string, SourceTask>();
          const seen = new Set<string>();
          let exhausted = false;
          const issues: string[] = [];
          for (let page = 0; page < 20; page++) {
            try {
              const data = parseRainActivities(
                await read(
                  `${origin}/v2/api/web/logs/learn/${encodeURIComponent(c.classroom_id)}?actype=-1&page=${page}&offset=100&sort=-1`,
                  headers,
                ),
                c.classroom_id,
                c.course?.name || c.name || "未命名课程",
                origin,
              );
              if (seen.has(data.fingerprint) && data.rowCount) {
                issues.push("雨课堂分页返回重复内容，已停止读取");
                break;
              }
              seen.add(data.fingerprint);
              for (const task of data.items)
                items.set(`${task.namespace}:${task.sourceId}`, task);
              if (items.size >= 2000) {
                issues.push("课程任务达到数量上限，未读取部分保留旧数据");
                break;
              }
              if (data.rowCount < 100) {
                exhausted = true;
                break;
              }
            } catch (error) {
              if (
                error instanceof CollectionError &&
                error.outcome !== "failed"
              )
                throw error;
              if (!items.size) throw error;
              if (error instanceof CollectionError && error.stop) {
                error.partial = {
                  items: [...items.values()].slice(0, 2000),
                  emptyConfirmed: false,
                  paginationComplete: false,
                  issues: [error.message],
                };
                throw error;
              }
              issues.push(
                "雨课堂后续分页读取失败，已读取任务保留，旧任务不撤回",
              );
              break;
            }
          }
          if (!exhausted && !issues.length)
            issues.push("雨课堂活动达到本轮分页上限");
          return {
            items: [...items.values()].slice(0, 2000),
            emptyConfirmed: exhausted && !items.size,
            paginationComplete: false,
            issues,
          };
        },
      );
    }
    try {
      const upcoming = z
        .object({
          data: z.object({
            upcomingExam: z
              .array(
                z.object({
                  classroom_id: Id,
                  title: z.string().trim().min(1).max(500),
                }),
              )
              .max(2000),
          }),
        })
        .parse(
          rainJson(
            await read(
              `${origin}/api/v3/classroom/on-lesson-upcoming-exam`,
              headers,
            ),
          ),
        ).data.upcomingExam;
      for (const exam of upcoming) {
        const matches = scan.result.partitions
          .flatMap((p) => p.items)
          .filter(
            (t) =>
              t.namespace === `classroom:${exam.classroom_id}:activity:5` &&
              t.title === exam.title,
          );
        // Only an unambiguous match in the platform's exam list supplies the type.
        if (matches.length === 1) matches[0].type = "exam";
      }
    } catch (error) {
      if (
        error instanceof CollectionError &&
        (error.stop || error.outcome !== "failed")
      )
        throw error;
      scan.result.issues.push(
        "雨课堂考试分类未读取，未确认类型的测验保留为习题",
      );
    }
  } catch (error) {
    scan.fail(error);
  }
  return scan.finish();
}
