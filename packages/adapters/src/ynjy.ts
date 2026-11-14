import { z } from "zod";
import type { Page } from "playwright";
import type { SourceConfig, SourceTask } from "../../contracts/src/index.js";
import { parsePage, parseTime } from "./parser.js";

// Schema from the read-only list response observed on the official classroom
// page. Status numbers and exam duration are not evidence of submission or due time.
const ExamList = z.object({
  status: z.literal(0),
  total_count: z.number().int().nonnegative(),
  exercises: z.array(z.object({
    id: z.union([z.string().min(1), z.number().int().nonnegative()]),
    exercise_name: z.string().trim().min(1).max(500),
    created_at: z.string().nullable().optional(),
  })).max(2000),
});
export function parseYnjyExams(data: unknown, source: SourceConfig) {
  const list = ExamList.parse(data);
  const classroom = new URL(source.url).pathname.match(/^\/classrooms\/([^/]+)\/exercise\/?$/)?.[1];
  if (!classroom) throw new Error("不是考试列表地址");
  const items: SourceTask[] = list.exercises.map((exam) => ({
    sourceId: String(exam.id),
    namespace: `classroom:${classroom}:exercise`,
    title: exam.exercise_name,
    course: source.course,
    type: "exam",
    sourceStatus: "unknown",
    startTime: { kind: "unknown" },
    deadline: { kind: "unknown" },
    publishTime: parseTime(exam.created_at ?? ""),
    url: source.url,
  }));
  return {
    auth: false, verification: false, items,
    emptyConfirmed: list.total_count === 0 && items.length === 0,
    paginationComplete: list.total_count === items.length,
    issues: [
      "考试列表未提供截止时间；答题时长不作为截止时间",
      ...(list.total_count > items.length ? ["考试列表还有未读取的分页"] : []),
    ],
  };
}
export async function collectYnjyPage(page: Page, source: SourceConfig) {
  const classroom = new URL(source.url).pathname.match(/^\/classrooms\/([^/]+)\/exercise\/?$/)?.[1];
  // Start listening before navigation; these cards use click handlers without
  // links, and networkidle can occur before their list response is rendered.
  const response = classroom ? page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === "https://jsjks.ynjy.cn" &&
      url.pathname === `/api/v2/courses/${classroom}/exercises.json` &&
      response.request().method() === "GET";
  }, { timeout: 25000 }).then(async (r) => r.ok() ? r.json() : undefined).catch(() => undefined) : undefined;
  await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 25000 });
  if (response) {
    const data = await response;
    if (data !== undefined) return parseYnjyExams(data, source);
  } else {
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return Array.from(document.querySelectorAll("a[href]")).some((a) =>
        /\/classrooms\/[^/]+\/(?:program_homework|common_homework|shixun_homework)\/[^/]+\/(?:detail|users)/.test(a.getAttribute("href") ?? "")) ||
        /暂无作业|暂无数据|账号登录|请先登录/.test(text);
    }, { timeout: 25000 }).catch(() => {});
  }
  return parsePage("ynjy", await page.content(), source);
}
