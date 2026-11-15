import { describe, expect, it, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request, type APIRequestContext } from "playwright";
import {
  collectRain,
  parseRainActivities,
  parseRainCourses,
  rainTime,
} from "../packages/adapters/src/yuketang.js";
import {
  collectChaoxing,
  parseChaoxingCourses,
  parseChaoxingList,
  parseChaoxingTimes,
  chaoxingTaskUrl,
} from "../packages/adapters/src/chaoxing.js";
import {
  CollectionError,
  courseReader,
  type ReadPage,
} from "../packages/adapters/src/course-http.js";
import {
  Adapters,
  type PlatformState,
} from "../packages/adapters/src/index.js";
import { Vault } from "../packages/adapters/src/vault.js";
import {
  ScanResult,
  safePlatformUrl,
} from "../packages/contracts/src/index.js";
import { Store } from "../packages/storage/src/index.js";
import { Engine } from "../packages/core/src/index.js";

const accountId = randomUUID(),
  origin = "https://www.yuketang.cn";
const json = (data: unknown) => JSON.stringify({ code: 0, data });
const activity = (id: number, extra = {}) => ({
  id,
  type: 5,
  title: "同名测验",
  create_time: 1794470400,
  ...extra,
});
const rainRead =
  (
    activities: (url: URL) => string | Promise<string>,
    courses = [{ classroom_id: 7, course: { name: "测试课程" } }],
  ): ReadPage =>
  async (raw) => {
    const u = new URL(raw);
    if (u.pathname.endsWith("basic-info")) return json({ id: 42 });
    if (u.pathname.endsWith("courses/list")) return json({ list: courses });
    if (u.pathname.endsWith("on-lesson-upcoming-exam"))
      return json({ upcomingExam: [] });
    return activities(u);
  };
const clazz = { courseId: "10", classId: "20", name: "测试课程" };
const coursesBody = JSON.stringify({
  result: 1,
  channelList: [
    { content: { id: 20, course: { data: [{ id: 10, name: "测试课程" }] } } },
  ],
});
const work = (id: string, data = `/work/phone/task-work?workId=${id}`) =>
  `<dt data="${data}" status="3"><h3>同名作业</h3><p>发布时间：2026-11-13 10:00</p></dt>`;
afterEach(() => vi.restoreAllMocks());

describe("雨课堂只读采集", () => {
  it('首次只读课程列表，选择后只读取已选课程任务，包括同名及空课程', async () => {
    const read = vi.fn(rainRead(() => json({activities:[]}), [{classroom_id:7,course:{name:'同名课程'}},{classroom_id:8,course:{name:'同名课程'}}]));
    const initial = await collectRain(read, accountId, origin, {}, []);
    expect(initial.courses).toHaveLength(2);
    expect(initial.partitions).toHaveLength(0);
    expect(read.mock.calls.every(([url]) => !url.includes('/logs/learn/'))).toBe(true);
    read.mockClear();
    const chosen = await collectRain(read, accountId, origin, {}, ['classroom:7']);
    expect(chosen.partitions).toHaveLength(1);
    expect(chosen.partitions[0].emptyConfirmed).toBe(true);
    expect(read.mock.calls.some(([url]) => url.includes('/learn/8'))).toBe(false);
  });
  it("保留同名任务的 ID、班级和类型作用域，不补造截止或提交状态", () => {
    const p = parseRainActivities(
      json({
        activities: [
          activity(1),
          activity(2, { type: 19, content: {} }),
          activity(3, { type: 99 }),
        ],
      }),
      "7",
      "课程",
      origin,
    );
    expect(p.items.map((t) => t.sourceId)).toEqual(["1", "2"]);
    expect(p.items[0]).toMatchObject({
      type: "quiz",
      deadline: { kind: "unknown" },
      sourceStatus: "unknown",
      url: `${origin}/v2/web/studentLog/7`,
    });
    expect(p.items[1]).toMatchObject({
      type: "homework",
      deadline: { kind: "unknown" },
      sourceStatus: "unknown",
    });
    expect(rainTime(1794470400)).toMatchObject({
      kind: "known",
      value: 1794470400000,
    });
    expect(rainTime(1794470400000)).toMatchObject({
      kind: "known",
      value: 1794470400000,
    });
    expect(rainTime(0).kind).toBe("unknown");
  });
  it("整页后继续请求下一页，短页只声明部分覆盖", async () => {
    const read = vi.fn(
      rainRead((u) =>
        json({
          activities:
            u.searchParams.get("page") === "0"
              ? Array.from({ length: 100 }, (_, i) => activity(i))
              : [activity(101)],
        }),
      ),
    );
    const result = ScanResult.parse(
      await collectRain(read, accountId, origin, {}),
    );
    expect(result).toMatchObject({
      outcome: "partial",
      discoveryComplete: false,
    });
    expect(result.partitions[0].items).toHaveLength(101);
    expect(read.mock.calls.some(([url]) => url.includes("page=1"))).toBe(true);
  });
  it("重复分页停止读取，分页失败保留已读任务", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => activity(i));
    const duplicate = await collectRain(
      rainRead(() => json({ activities: rows })),
      accountId,
      origin,
      {},
    );
    expect(duplicate.partitions[0].items).toHaveLength(100);
    expect(duplicate.partitions[0].issues.join()).toContain("重复");
    const partial = await collectRain(
      rainRead((u) => {
        if (u.searchParams.get("page") === "1") throw new Error("network");
        return json({ activities: rows });
      }),
      accountId,
      origin,
      {},
    );
    expect(partial.partitions[0].items).toHaveLength(100);
    expect(partial.partitions[0].issues.join()).toContain("分页读取失败");
  });
  it("课程响应失效、未知结构不能变成空账号；人工验证清除本轮候选", async () => {
    expect(() => parseRainCourses('{"code":0,"data":{}}')).toThrow();
    const result = await collectRain(
      async () => '{"code":401,"msg":"请登录"}',
      accountId,
      origin,
      {},
    );
    expect(result).toMatchObject({ outcome: "auth_required", partitions: [] });
    const verifiedEmpty = await collectRain(
      rainRead(() => json({ activities: [] })),
      accountId,
      origin,
      {},
    );
    expect(verifiedEmpty.partitions[0].emptyConfirmed).toBe(true);
    const blocked = await collectRain(
      rainRead(() => {
        throw new CollectionError("验证", "verification_required", true);
      }),
      accountId,
      origin,
      {},
    );
    expect(blocked).toMatchObject({
      outcome: "verification_required",
      partitions: [],
    });
  });
  it("考试分类只采用官方考试列表的唯一匹配，标题含考试不会自行归类", async () => {
    const read = rainRead(() =>
      json({ activities: [activity(1, { title: "期中考试" }), activity(2)] }),
    );
    const result = await collectRain(
      async (url, h) =>
        url.endsWith("on-lesson-upcoming-exam")
          ? json({ upcomingExam: [{ classroom_id: 7, title: "同名测验" }] })
          : read(url, h),
      accountId,
      origin,
      {},
    );
    expect(result.partitions[0].items.map((t) => t.type)).toEqual([
      "quiz",
      "exam",
    ]);
  });
});

describe("学习通只读采集", () => {
  it('未选择课程时不请求作业和考试列表', async () => {
    const read = vi.fn(async () => coursesBody);
    const result = await collectChaoxing(read, accountId, []);
    expect(result.courses).toEqual([{key:'course:10:class:20',name:'测试课程'}]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.partitions).toHaveLength(0);
  });
  it("兼容课程 content 为字符串、课程下多个班级，未知响应报错", () => {
    expect(parseChaoxingCourses(coursesBody)).toEqual([clazz]);
    expect(
      parseChaoxingCourses(
        JSON.stringify({
          result: 1,
          channelList: [
            {
              content: JSON.stringify({
                id: 10,
                name: "测试课程",
                clazz: [{ id: 20 }, { id: 21 }],
              }),
            },
          ],
        }),
      ),
    ).toHaveLength(2);
    expect(() =>
      parseChaoxingCourses('{"result":0,"msg":"系统错误"}'),
    ).toThrow();
    expect(() => parseChaoxingCourses('{"result":1}')).toThrow();
  });
  it("同名作业按平台 ID 区分，跨班级隔离；缺 ID 或答题地址跳过", () => {
    const list = parseChaoxingList(
      work("1") +
        work("2") +
        work("bad", "/work/phone/task-work") +
        work("bad", "/mooc-ans/work/doHomeWorkNew?workId=3"),
      clazz,
      "homework",
    );
    expect(list.items.map((t) => t.sourceId)).toEqual(["1", "2"]);
    expect(list.items[0]).toMatchObject({
      namespace: "course:10:class:20:homework",
      sourceStatus: "submitted",
    });
    expect(list.issues.join()).toContain("已跳过");
    expect(
      parseChaoxingList(work("1"), { ...clazz, classId: "21" }, "homework")
        .items[0].namespace,
    ).not.toBe(list.items[0].namespace);
    expect(
      chaoxingTaskUrl(
        "https://evil.example/work/phone/task-work?workId=1",
        "homework",
      ),
    ).toBeUndefined();
  });
  it("只读明确时间标签，不把考试时长或提交时间当截止", () => {
    const times = parseChaoxingTimes(
      "<p>开始时间：2026-11-13 08:00</p><p>截止时间：2026-11-14 09:30</p>",
    );
    expect(times.deadline).toMatchObject({
      kind: "known",
      value: Date.parse("2026-11-14T09:30:00+08:00"),
    });
    expect(
      parseChaoxingTimes(
        "<p>考试时长：90 分钟</p><p>提交时间：2026-11-13 09:30</p>",
      ).deadline.kind,
    ).toBe("unknown");
  });
  it("一个分类失败仍读取另一分类，不请求答题链接", async () => {
    const urls: string[] = [];
    const result = ScanResult.parse(
      await collectChaoxing(async (url) => {
        urls.push(url);
        if (url.includes("backclazzdata")) return coursesBody;
        if (url.includes("workList"))
          return (
            work("1") + work("bad", "/mooc-ans/work/doHomeWorkNew?workId=3")
          );
        if (url.includes("examList")) throw new Error("network");
        return "<p>截止时间：2026-11-14 09:30</p>";
      }, accountId),
    );
    expect(result.outcome).toBe("partial");
    expect(result.partitions.map((p) => p.outcome)).toEqual([
      "partial",
      "failed",
    ]);
    expect(result.partitions[0].items[0].deadline.kind).toBe("known");
    expect(urls.some((url) => url.includes("doHomeWork"))).toBe(false);
  });
  it("失效登录不提交先前课程任务；明确空列表才记为合法空", async () => {
    const result = await collectChaoxing(async (url) => {
      if (url.includes("backclazzdata")) return coursesBody;
      if (url.includes("workList")) return work("1");
      if (url.includes("examList")) return '<input type="password">账号登录';
      return "<p>暂无时间</p>";
    }, accountId);
    expect(result).toMatchObject({ outcome: "auth_required", partitions: [] });
    expect(
      parseChaoxingList("<p>暂无作业</p>", clazz, "homework").emptyConfirmed,
    ).toBe(true);
    expect(
      parseChaoxingList("<p>系统错误</p>", clazz, "homework").emptyConfirmed,
    ).toBe(false);
  });
});

it("HTTP 429 停止请求并释放响应，登录 HTML 不作为空数据", async () => {
  const dispose = vi.fn(async () => {});
  const get = vi.fn(async () => ({
    status: () => 429,
    url: () => `${origin}/api/v3/user/basic-info`,
    ok: () => false,
    headers: () => ({}),
    dispose,
  }));
  const read = courseReader(
    { get } as unknown as APIRequestContext,
    "yuketang",
  );
  await expect(read(`${origin}/api/v3/user/basic-info`)).rejects.toMatchObject({
    stop: true,
  });
  expect(dispose).toHaveBeenCalledTimes(1);
});

it.each(["yuketang", "chaoxing"] as const)(
  "%s 无需配置列表即可进入 HTTP 采集，不启动浏览器",
  async (id) => {
    vi.spyOn(Vault.prototype, "read").mockResolvedValue({
      cookies: [],
      origins: [],
    });
    vi.spyOn(Vault.prototype, "save").mockResolvedValue(undefined);
    const dispose = vi.fn(async () => {});
    vi.spyOn(request, "newContext").mockResolvedValue({
      storageState: async () => ({ cookies: [], origins: [] }),
      dispose,
      get: async (url: string) => ({
        url: () => url,
        status: () => 200,
        ok: () => true,
        headers: () => ({}),
        dispose: async () => {},
        text: async () =>
          id === "chaoxing"
            ? '{"result":1,"channelList":[]}'
            : url.includes("basic-info")
              ? json({ id: 42 })
              : url.includes("upcoming-exam")
                ? json({ upcomingExam: [] })
                : json({ list: [] }),
      }),
    } as unknown as APIRequestContext);
    const result = await new Adapters("unused-course-test").scan({
      id,
      accountId,
      sources: [],
    } as unknown as PlatformState);
    expect(ScanResult.parse(result).outcome).toBe("partial");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(
      safePlatformUrl(
        "chaoxing",
        "https://mooc1-api.chaoxing.com/mycourse/backclazzdata",
      ),
    ).toBe(true);
  },
);

it("真实引擎处理部分采集、未知字段和后续失败时保留旧任务与截止", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cw-course-engine-"));
  const store = new Store(join(dir, "test.sqlite")),
    engine = new Engine(store);
  try {
    const first = await collectRain(
      rainRead(() =>
        json({ activities: [activity(1, { deadline: 1794556800 })] }),
      ),
      accountId,
      origin,
      {},
    );
    engine.apply(first);
    const initial = engine.tasks()[0];
    engine.apply(
      await collectRain(
        rainRead(() => json({ activities: [activity(1)] })),
        accountId,
        origin,
        {},
      ),
    );
    engine.apply(
      await collectRain(
        async () => {
          throw new Error("network");
        },
        accountId,
        origin,
        {},
      ),
    );
    expect(engine.tasks()).toHaveLength(1);
    expect(engine.tasks()[0]).toMatchObject({
      id: initial.id,
      deadline: initial.deadline,
      needsReview: false,
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("雨课堂在后续分页限流时保留已读任务并停止，不再请求其他课程或分类", async () => {
  const urls: string[] = [];
  const base = rainRead(
    (u) => {
      if (u.searchParams.get("page") === "1")
        throw new CollectionError("平台限流", "failed", true);
      return json({
        activities: Array.from({ length: 100 }, (_, i) => activity(i)),
      });
    },
    [
      { classroom_id: 7, course: { name: "课程一" } },
      { classroom_id: 8, course: { name: "课程二" } },
    ],
  );
  const result = await collectRain(
    async (url, headers) => {
      urls.push(url);
      return base(url, headers);
    },
    accountId,
    origin,
    {},
  );
  expect(result.outcome).toBe("partial");
  expect(result.partitions[0].items).toHaveLength(100);
  expect(urls.at(-1)).toContain("page=1");
  expect(
    urls.some((u) => u.includes("learn/8") || u.includes("upcoming-exam")),
  ).toBe(false);
});
it("学习通在详情限流时保留列表，停止后续详情和考试请求", async () => {
  const urls: string[] = [];
  const result = await collectChaoxing(async (url) => {
    urls.push(url);
    if (url.includes("backclazzdata")) return coursesBody;
    if (url.includes("workList")) return work("1") + work("2");
    throw new CollectionError("平台限流", "failed", true);
  }, accountId);
  expect(result.outcome).toBe("partial");
  expect(result.partitions[0].items).toHaveLength(2);
  expect(urls).toHaveLength(3);
  expect(urls.some((u) => u.includes("examList"))).toBe(false);
});

it("雨课堂 HTTP 200 的 UNAUTHENTICATED 按登录失效处理", async () => {
  const result = await collectRain(
    async () => '{"code":50000,"msg":"UNAUTHENTICATED","data":""}',
    accountId,
    origin,
    {},
  );
  expect(result).toMatchObject({ outcome: "auth_required", partitions: [] });
});
