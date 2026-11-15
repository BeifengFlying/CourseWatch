import { load } from "cheerio";
import { ZodError } from "zod";
import type { BrowserContext } from "playwright";
import { safePlatformUrl, type PlatformId } from "../../contracts/src/index.js";
import { getPlatformPage } from "./http.js";

// Login evidence is independent of course discovery and task parsing.
export function inspectSession(html: string, platform?: PlatformId) {
  const $ = load(html);
  $("script,style,noscript,[hidden],[aria-hidden=true]").remove();
  $("[style]").each((_, el) => {
    if (
      /display\s*:\s*none|visibility\s*:\s*hidden/i.test(
        $(el).attr("style") ?? "",
      )
    )
      $(el).remove();
  });
  const text = $("body").text();
  const logout = $("a,button,[role=button],input[type=button]")
    .toArray()
    .some((el) => {
      const node = $(el);
      const labels = [
        node.text(),
        node.attr("title"),
        node.attr("aria-label"),
        node.attr("value"),
      ];
      return (
        labels.some((label) =>
          /^(退出|注销|退出登录|退出系统|安全退出|登出|logout|sign out)$/i.test(
            label?.trim() ?? "",
          ),
        ) ||
        /(?:^|[\/\s.:])(?:logout|signout)(?:[\s(/?#;]|$)/i.test(
          [node.attr("href"), node.attr("onclick")].join(" "),
        )
      );
    });
  const loginForm = $("input[type=password]").length > 0;
  // Renwei's authenticated shell has no visible logout control until its
  // account menu opens. It also keeps a captcha component in the page.
  // Recognize the account navigation without requiring any task rows.
  const accountLinks = new Set<string>();
  if (platform === "renwei" && !loginForm) {
    const paths = new Set([
      "/exam/a/exam/exam/myExamList",
      "/exam/a/exam/examTask/myExamTaskList",
      "/exam/a/question/questionCollect/myListByType",
      "/exam/a/exam/questionWrong/myListByType",
    ]);
    $("a[href]").each((_, el) => {
      try {
        const url = new URL($(el).attr("href")!, "https://tk.ipmph.com");
        if (safePlatformUrl("renwei", url.href) && paths.has(url.pathname))
          accountLinks.add(url.pathname);
      } catch { /* Ignore malformed navigation links. */ }
    });
  }
  const authenticated =
    accountLinks.size >= 2 ||
    logout ||
    /退出登录|安全退出|注销登录/.test(text) ||
    (/退出|注销/.test(text) && /我的作业|我的考试|教学课堂/.test(text));
  return {
    authenticated,
    login:
      !authenticated &&
      (loginForm ||
        /账号登录|人卫账号登录|请先登录/.test(text)),
    verification:
      !authenticated && /请完成.*验证|安全验证|滑动.*验证/.test(text),
  };
}

export async function confirmLogin(context: BrowserContext, id: PlatformId, onCourses?: (courses: { key: string; name: string }[]) => void) {
  if (id === "yuketang" || id === "chaoxing" || id === "unipus") {
    // Verify a protected read-only endpoint with this browser's own session.
    // Cookie presence or a public landing page does not prove authentication.
    const { courseReader, CollectionError } = await import("./course-http.js");
    const read = courseReader(context.request, id);
    try {
      if (id === "yuketang") {
        const origin = "https://www.yuketang.cn";
        const csrf = (await context.cookies(origin)).find(c => c.name === "csrftoken")?.value;
        const { parseRainUser } = await import("./yuketang.js");
        parseRainUser(await read(`${origin}/api/v3/user/basic-info`, { xtbz: "ykt", Referer: `${origin}/v2/web/index`, ...(csrf ? { "X-CSRFToken": csrf } : {}) }));
      } else if (id === "unipus") {
        const { parseUnipusCourses, unipusUrls, unipusHeaders } = await import("./unipus.js");
        parseUnipusCourses(await read(unipusUrls.courses, unipusHeaders(await context.storageState())));
      } else {
        const { readChaoxingCourses } = await import("./chaoxing.js");
        const courses = await readChaoxingCourses(read);
        onCourses?.(courses.map(c => ({ key: `course:${c.courseId}:class:${c.classId}`, name: c.name })));
      }
      return;
    } catch (error) {
      if (error instanceof CollectionError && error.outcome === "verification_required")
        throw new Error("请先在官方窗口完成验证，再点击完成登录");
      if (id === "chaoxing" && !(error instanceof CollectionError && error.outcome === "auth_required")) {
        if (error instanceof CollectionError) throw new Error(`学习通登录校验未完成：${error.message}`);
        if (error instanceof ZodError) throw new Error("学习通登录校验未完成：课程响应结构无法识别，请稍后重试；登录窗口已保留");
        if (error instanceof Error && /timeout|超时/i.test(error.message)) throw new Error("学习通登录校验请求超时，请检查网络后重试；登录窗口已保留");
        throw new Error("学习通登录校验请求失败，请检查网络后重试；登录窗口已保留");
      }
      throw new Error("尚未确认登录成功，请完成官方登录并进入课程页后重试");
    }
  }
  // SSO can leave an old login tab open. Inspect all official frames, rather
  // than requiring the last tab or a particular task page to be active.
  let official = false;
  let verification = false;
  for (const page of context.pages()) {
    for (const frame of page.frames()) {
      if (!safePlatformUrl(id, frame.url())) continue;
      official = true;
      try {
        const result = inspectSession(await frame.content(), id);
        if (result.authenticated) return;
        verification ||= result.verification;
      } catch {
        /* A frame may be replaced during the SSO redirect. */
      }
    }
  }
  if (id === "renwei") {
    // The protected account home redirects anonymous requests to adminlogin.
    // Probe it using this browser's cookies, without moving the user's tab.
    try {
      const response = await getPlatformPage(
        context.request,
        id,
        "https://tk.ipmph.com/exam/a/",
        12000,
      );
      if (
        response.ok() &&
        safePlatformUrl(id, response.url()) &&
        /^\/exam\/a\/?$/.test(new URL(response.url()).pathname)
      ) {
        const html = await response.text();
        const result = inspectSession(html, id);
        const $ = load(html);
        const accountNavigation = $("a[href]")
          .toArray()
          .some((el) =>
            /\/exam\/a\/(?:exam\/examTask|sys\/user\/info)/.test(
              $(el).attr("href") ?? "",
            ),
          );
        if (
          !result.login &&
          !result.verification &&
          (result.authenticated || accountNavigation)
        )
          return;
        verification ||= result.verification;
      }
    } catch {
      /* Keep the login window open so the user can retry. */
    }
  }
  if (verification) throw new Error("请先在官方窗口完成验证，再点击完成登录");
  throw new Error(
    official
      ? "尚未确认登录成功，请完成官方登录后重试；无需进入任务列表"
      : "请先完成官方登录并返回平台页面，再点击完成登录",
  );
}
