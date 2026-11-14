import { load } from "cheerio";
import type {
  PlatformId,
  SourceTask,
  SourceConfig,
} from "../../contracts/src/index.js";
import { safePlatformUrl } from "../../contracts/src/index.js";
import { inspectSession } from "./session.js";
export function parseTime(raw: string): SourceTask["deadline"] {
  if (/^(无截止时间|不限|长期有效)$/.test(raw.trim()))
    return { kind: "none", raw };
  const m = raw.match(
    /(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?[ T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!m) return { kind: "unknown", raw: raw.slice(0, 120) };
  const [, y, mo, d, h, mi, se = "0"] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi}:${se.padStart(2, "0")}+08:00`;
  const value = Date.parse(iso);
  if (
    !Number.isFinite(value) ||
    +mo < 1 ||
    +mo > 12 ||
    +h > 23 ||
    +mi > 59 ||
    +se > 59 ||
    +d < 1 ||
    +d > new Date(Date.UTC(+y, +mo, 0)).getUTCDate()
  )
    return { kind: "unknown", raw };
  return { kind: "known", value, raw: m[0], timezone: "Asia/Shanghai" };
}
export function parsePage(
  platform: PlatformId,
  html: string,
  source: SourceConfig,
) {
  const $ = load(html);
  $("script,style,noscript").remove();
  const text = $("body").text();
  const issues: string[] = [];
  const items: SourceTask[] = [];
  const session = inspectSession(html, platform);
  const authenticated = session.authenticated ||
    (platform === "ynjy" && /当前身份：?\s*学生|退出课堂/.test(text) && /作业|考试/.test(text));
  const loginForm = $("input[type=password]").length > 0;
  if (
    (loginForm && !authenticated) ||
    (!authenticated && /请.*登录|账号登录|人卫账号/.test(text))
  )
    return {
      auth: true,
      verification: false,
      items,
      issues: ["会话失效或返回登录页面"],
      paginationComplete: false,
      emptyConfirmed: false,
    };
  if (!authenticated && session.verification)
    return {
      auth: false,
      verification: true,
      items,
      issues: ["平台要求人工验证"],
      paginationComplete: false,
      emptyConfirmed: false,
    };
  if (!authenticated) issues.push("未确认登录身份，当前解析仅作为候选结果");
  if (platform === "ynjy") {
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const match = href.match(
        /\/classrooms\/([^/?#]+)\/(program_homework|common_homework|exercise|shixun_homework)\/([^/?#]+)\/(detail|users|settings)/,
      );
      if (!match || match[4] === "settings") return;
      const title = $(el).text().trim();
      if (!title) return;
      let container = $(el);
      for (let n = 0; n < 6; n++) {
        if (
          (container.text().match(/20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}/g) || [])
            .length >= 2
        )
          break;
        const parent = container.parent();
        if (!parent.length || parent.text().length > 3000) break;
        container = parent;
      }
      const content = container.text();
      const dates =
        content.match(
          /20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?\s+\d{1,2}:\d{2}(?::\d{2})?/g,
        ) || [];
      const containerIds = new Set(
        container
          .find("a[href]")
          .addBack("a[href]")
          .toArray()
          .map(
            (a) =>
              ($(a).attr("href") ?? "").match(
                /\/(?:program_homework|common_homework|exercise|shixun_homework)\/([^/?#]+)\//,
              )?.[1],
          )
          .filter(Boolean),
      );
      const unambiguousTimes = dates.length === 2 && containerIds.size === 1;
      const url = new URL(href, source.url);
      url.search = "";
      url.hash = "";
      if (!safePlatformUrl(platform, url.href)) return;
      items.push({
        sourceId: match[3],
        namespace: `classroom:${match[1]}:${match[2]}`,
        title,
        course: source.course,
        type: source.type,
        sourceStatus: "unknown",
        startTime: unambiguousTimes ? parseTime(dates[0]) : { kind: "unknown" },
        deadline: unambiguousTimes ? parseTime(dates[1]) : { kind: "unknown" },
        publishTime: { kind: "unknown" },
        url: url.href,
      });
    });
  } else {
    $("table").each((_, table) => {
      const headers = $(table)
        .find("thead th")
        .map((_, h) => $(h).text().trim())
        .get();
      if (!headers.length)
        $(table)
          .find("tr")
          .first()
          .find("th")
          .each((_, h) => {
            headers.push($(h).text().trim());
          });
      const titleIndex = headers.findIndex((h) => /作业名称|考试名称/.test(h));
      if (titleIndex < 0) return;
      $(table)
        .find("tbody tr")
        .each((_, row) => {
          const cells = $(row).find("td");
          if (cells.length <= titleIndex) return;
          const title = cells.eq(titleIndex).text().trim();
          if (!title) return;
          const link = $(row)
            .find("a[href]")
            .toArray()
            .map((a) => $(a).attr("href")!)
            .find((h) => !h.startsWith("javascript:") && !h.startsWith("#"));
          // The official list uses examStudent_<stable ID>, including rows
          // whose only actions are JavaScript buttons. Never execute them.
          const dataId = $(row).attr("data-id") ||
            $(row).attr("id")?.match(/^examStudent_([\w-]+)$/)?.[1];
          let linkUrl: URL | undefined;
          try { if (link) linkUrl = new URL(link, source.url); } catch { /* Skip malformed links. */ }
          const id =
            dataId ||
            linkUrl?.searchParams.get("id") ||
            linkUrl?.searchParams.get("examId") ||
            linkUrl?.searchParams.get("taskId");
          if (!id) {
            issues.push("存在缺少稳定来源 ID 的行，已跳过");
            return;
          }
          const cell = (re: RegExp) => {
            const i = headers.findIndex((h) => re.test(h));
            return i < 0 ? "" : cells.eq(i).text().trim();
          };
          const status = cell(/状态/);
          const url =
            linkUrl && safePlatformUrl(platform, linkUrl.href)
              ? linkUrl.href
              : source.url;
          items.push({
            sourceId: id,
            namespace: `renwei:${source.type}`,
            title,
            course: cell(/学科|课程/) || source.course,
            type: source.type,
            sourceStatus: /已完成|已提交/.test(status)
              ? "submitted"
              : /已批阅/.test(status)
                ? "graded"
                : /未完成|未提交/.test(status)
                  ? "pending"
                  : "unknown",
            startTime: parseTime(cell(/开始时间/)),
            deadline: parseTime(cell(/结束时间|截止时间/)),
            publishTime: { kind: "unknown" },
            url,
          });
        });
    });
  }
  const unique = [
    ...new Map(items.map((t) => [`${t.namespace}:${t.sourceId}`, t])).values(),
  ];
  const emptyConfirmed =
    authenticated &&
    /暂无作业|暂无考试|暂无数据|没有相关任务/.test(text) &&
    unique.length === 0;
  // Pagination is unverified in the first adapter revision. Never claim a whole account snapshot.
  if (!unique.length && !emptyConfirmed)
    issues.push("未识别到任务或合法空列表，请检查列表地址与页面结构");
  issues.push("仅覆盖配置页面；分页与全部课程覆盖尚未验证");
  return {
    auth: false,
    verification: false,
    items: authenticated ? unique : [],
    issues: [...new Set(issues)].slice(0, 30),
    paginationComplete: false,
    emptyConfirmed,
  };
}
