import { expect, it, vi } from "vitest";
import type { BrowserContext } from "playwright";
import { confirmLogin } from "../packages/adapters/src/session.js";
import { chaoxingCoursesUrl, chaoxingWebCoursesUrl, collectChaoxing, parseChaoxingWebCourses, readChaoxingCourses } from "../packages/adapters/src/chaoxing.js";
import { CollectionError } from "../packages/adapters/src/course-http.js";
import { diagnosticErrorFacts, diagnosticReason } from "../packages/core/src/diagnostics.js";

const webCourses = `<div id="courseList"><ul id="courselistArea">
  <li class="course learnCourse stu_20" id="c_10"><h3><a href="/visit/stucoursemiddle?courseid=10&amp;clazzid=20&amp;cpi=30">测试课程</a></h3></li>
  <li class="course learnCourse stu_21" id="c_11"><h3><a href="/visit/stucoursemiddle?courseid=11&amp;clazzid=21&amp;cpi=31">测试课程</a></h3></li>
</ul></div>`;
const courses = [{ courseId: "10", classId: "20", name: "测试课程" }, { courseId: "11", classId: "21", name: "测试课程" }];

it("移动接口拒绝网页会话时，登录与后台同步复用受保护网页课程读取", async () => {
  const get = vi.fn(async (url: string) => ({
    url: () => url, status: () => 200, ok: () => true, headers: () => ({}), dispose: vi.fn(async () => {}),
    text: async () => url === chaoxingCoursesUrl ? '{"result":0,"msg":"请重新登录"}' : webCourses,
  }));
  const onCourses = vi.fn();
  await confirmLogin({ request: { get } } as unknown as BrowserContext, "chaoxing", onCourses);
  expect(get.mock.calls.map(([url]) => url)).toEqual([chaoxingCoursesUrl, chaoxingWebCoursesUrl]);
  expect(onCourses).toHaveBeenCalledWith(courses.map(c => ({ key: `course:${c.courseId}:class:${c.classId}`, name: c.name })));
  const read = vi.fn(async (url: string) => url === chaoxingCoursesUrl ? '{"result":0,"msg":"请重新登录"}' : webCourses);
  const result = await collectChaoxing(read, "fixture-account", []);
  expect(result).toMatchObject({ outcome: "partial", courses: onCourses.mock.calls[0][0], partitions: [] });
  expect(read).toHaveBeenCalledTimes(2);
});

it.each([
  '<button>退出登录</button>',
  '<div id="courseList"><ul id="courselistArea"></ul></div>',
  webCourses.replaceAll('class="course learnCourse', 'hidden class="course learnCourse'),
  webCourses.replaceAll('/visit/stucoursemiddle?', 'https://example.com/visit/stucoursemiddle?'),
  webCourses.replace('stu_20', 'stu_99'),
  webCourses.replace('c_10', 'c_99'),
  webCourses.replace('clazzid=20', 'clazzid='),
  webCourses.replace('clazzid=20', 'clazzid=20&amp;clazzid=99'),
  webCourses.replace('/visit/stucoursemiddle?', '/work/doHomeWorkNew?'),
  webCourses + '<input type="password">账号登录',
])("未知、隐藏、非官方或不一致的网页不能确认登录：%#", html => {
  expect(() => parseChaoxingWebCourses(html)).toThrow();
});

it("网页课程保留同名的不同课程与班级", () => {
  expect(parseChaoxingWebCourses(webCourses)).toEqual(courses);
});

it("移动接口数据格式变化时仍可读取网页课程", async () => {
  const read = vi.fn(async (url: string) => url === chaoxingCoursesUrl ? '{"result":1,"channelList":null}' : webCourses);
  await expect(readChaoxingCourses(read)).resolves.toEqual(courses);
  expect(read).toHaveBeenCalledTimes(2);
});

it("移动接口拒绝会话、网页结构未知时说明校验未完成，不认定网页登录失效", async () => {
  const get = vi.fn(async (url: string) => ({
    url: () => url, status: () => 200, ok: () => true, headers: () => ({}), dispose: async () => {},
    text: async () => url === chaoxingCoursesUrl ? '{"result":0,"msg":"请重新登录"}' : '<button>退出登录</button>',
  }));
  await expect(confirmLogin({ request: { get } } as unknown as BrowserContext, "chaoxing")).rejects.toThrow("网页课程列表尚未加载或结构无法识别");
});

it.each([
  new CollectionError("平台限流，本轮已停止", "failed", true),
  new CollectionError("平台要求人工验证", "verification_required", true),
  new CollectionError("本轮达到请求数量或时间上限", "failed", true),
])("限流、人工验证及请求上限不触发网页备用请求：%s", async error => {
  const read = vi.fn().mockRejectedValue(error);
  await expect(readChaoxingCourses(read)).rejects.toBe(error);
  expect(read).toHaveBeenCalledTimes(1);
});

it("网络失败不会被提示为尚未登录", async () => {
  const ctx = { request: { get: vi.fn().mockRejectedValue(new Error("net::ERR_CONNECTION_RESET secret-token")) } } as unknown as BrowserContext;
  await expect(confirmLogin(ctx, "chaoxing")).rejects.toThrow("登录校验请求失败");
  await expect(confirmLogin(ctx, "chaoxing")).rejects.not.toThrow("secret-token");
});

it("请求被诊断包装后仍显示超时，并保留请求阶段和脱敏错误类别", async () => {
  const ctx = { request: { get: vi.fn().mockRejectedValue(new Error("apiRequestContext.get: Timeout 15000ms exceeded token=private")) } } as unknown as BrowserContext;
  const error = await confirmLogin(ctx, "chaoxing").catch(error => error);
  expect(error.message).toContain("登录校验请求超时");
  expect(error.message).not.toContain("private");
  expect(diagnosticReason(error)).toBe("timeout");
  const facts = diagnosticErrorFacts(error);
  expect(facts).toMatchObject({ failureStage: "login-confirm", method: "GET", operation: "apiRequestContext.get", timeoutMs: 15000 });
  expect(JSON.stringify(facts)).not.toContain("private");
});

it("两个入口都要求登录时仍拒绝保存会话", async () => {
  const get = vi.fn(async (url: string) => ({
    url: () => url, status: () => 200, ok: () => true, headers: () => ({}), dispose: async () => {},
    text: async () => url === chaoxingCoursesUrl ? '{"result":0,"msg":"请重新登录"}' : '<input type="password">账号登录',
  }));
  const onCourses = vi.fn();
  await expect(confirmLogin({ request: { get } } as unknown as BrowserContext, "chaoxing", onCourses)).rejects.toThrow("尚未确认登录成功");
  expect(onCourses).not.toHaveBeenCalled();
});
