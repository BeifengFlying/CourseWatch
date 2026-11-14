import { afterEach, expect, it, vi } from "vitest";
import type { APIRequestContext } from "playwright";
import { request } from "playwright";
import { createServer } from "node:http";
import { getPlatformPage } from "../packages/adapters/src/http.js";
import {
  safeMonitorUrl,
  safePlatformReadUrl,
} from "../packages/contracts/src/index.js";
import { Adapters } from "../packages/adapters/src/index.js";
import { Vault } from "../packages/adapters/src/vault.js";
import type { PlatformState } from "../packages/adapters/src/index.js";

afterEach(() => vi.restoreAllMocks());

function clientFor(locations: string[]) {
  const disposed = vi.fn(async () => {});
  const get = vi.fn(
    async (
      _url: string,
      _options: { maxRedirects: number; timeout: number },
    ) => ({
      status: () => (locations.length ? 302 : 200),
      headers: () => ({ location: locations.shift() }),
      dispose: disposed,
    }),
  );
  return {
    client: { get } as unknown as Pick<APIRequestContext, "get">,
    get,
    disposed,
  };
}

it.each([
  "http://127.0.0.1:17321/api/pair",
  "http://169.254.169.254/latest/meta-data/",
  "https://evil.example/",
  "https://tk.ipmph.com.evil.example/",
  "https://user:password@tk.ipmph.com/",
  "https://tk.ipmph.com:8443/",
  "https://tk.ipmph.com/exam/a/%73ubmit",
  "/exam/a/%256cogout",
])("HTTP 重定向在发送请求前拒绝目标：%s", async (location) => {
  const { client, get, disposed } = clientFor([location]);
  await expect(
    getPlatformPage(client, "renwei", "https://tk.ipmph.com/exam/a/"),
  ).rejects.toThrow("拒绝访问");
  expect(get).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith("https://tk.ipmph.com/exam/a/", {
    maxRedirects: 0,
    timeout: expect.any(Number),
  });
  expect(disposed).toHaveBeenCalledTimes(1);
});

it("真实 HTTP 客户端不会跟随重定向请求本地目标", async () => {
  let targetRequests = 0;
  const server = createServer((req, reply) => {
    if (req.url === "/start") {
      reply.writeHead(302, { location: "/private" });
      reply.end();
    } else {
      targetRequests++;
      reply.end("fixture");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("测试服务器未启动");
  const local = `http://127.0.0.1:${address.port}`;
  const http = await request.newContext();
  try {
    // Establish that this fixture follows redirects with the old defaults.
    const baseline = await http.get(`${local}/start`);
    expect(baseline.status()).toBe(200);
    expect(targetRequests).toBe(1);
    targetRequests = 0;
    const get = vi.fn(
      async (
        _url: string,
        options: Parameters<APIRequestContext["get"]>[1],
      ) => {
        const response = await http.get(`${local}/start`, options);
        // Model an official endpoint redirecting to the controlled local target.
        return {
          status: () => response.status(),
          headers: () => ({ location: `${local}/private` }),
          dispose: () => response.dispose(),
        };
      },
    );
    await expect(
      getPlatformPage(
        { get } as unknown as APIRequestContext,
        "renwei",
        "https://tk.ipmph.com/exam/a/",
      ),
    ).rejects.toThrow("拒绝访问");
    expect(get).toHaveBeenCalledTimes(1);
    expect(targetRequests).toBe(0);
  } finally {
    await http.dispose();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("官方相对重定向逐跳校验，允许登录页用于识别会话失效", async () => {
  const { client, get } = clientFor(["/exam/a/", "/exam/a/adminlogin"]);
  const response = await getPlatformPage(
    client,
    "renwei",
    "https://tk.ipmph.com/exam/",
  );
  expect(response.status()).toBe(200);
  expect(get.mock.calls.map((call) => call[0])).toEqual([
    "https://tk.ipmph.com/exam/",
    "https://tk.ipmph.com/exam/a/",
    "https://tk.ipmph.com/exam/a/adminlogin",
  ]);
  for (const call of get.mock.calls) expect(call[1].maxRedirects).toBe(0);
});

it("多次重定向中的外站目标仍被拒绝，循环最多跟随五次", async () => {
  const chain = clientFor(["/exam/a/", "https://evil.example/"]);
  await expect(
    getPlatformPage(chain.client, "renwei", "https://tk.ipmph.com/exam/"),
  ).rejects.toThrow("拒绝访问");
  expect(chain.get).toHaveBeenCalledTimes(2);
  const loop = clientFor(Array(7).fill("/exam/a/"));
  await expect(
    getPlatformPage(loop.client, "renwei", "https://tk.ipmph.com/exam/"),
  ).rejects.toThrow("重定向次数");
  expect(loop.get).toHaveBeenCalledTimes(6);
});

it("初始非法地址不发请求；列表过滤拒绝编码操作和路由片段", async () => {
  const { client, get } = clientFor([]);
  await expect(
    getPlatformPage(client, "renwei", "http://127.0.0.1/"),
  ).rejects.toThrow("拒绝访问");
  expect(get).not.toHaveBeenCalled();
  for (const path of [
    "%73ubmit",
    "%2573ubmit",
    "%252573ubmit",
    "#/submit",
    "%6Cogout",
    "%ZZ",
    "%",
    "%2525252573ubmit",
  ])
    expect(
      safeMonitorUrl("ynjy", `https://jsjks.ynjy.cn/classrooms/1/${path}`),
      path,
    ).toBe(false);
  expect(
    safeMonitorUrl(
      "ynjy",
      "https://jsjks.ynjy.cn/classrooms/1/program_homework?type=1",
    ),
  ).toBe(true);
  expect(
    safeMonitorUrl("renwei", "https://tk.ipmph.com/exam/a/adminlogin"),
  ).toBe(false);
  expect(
    safePlatformReadUrl("renwei", "https://tk.ipmph.com/exam/a/adminlogin"),
  ).toBe(true);
});

it("旧配置中的非法来源在读取会话和启动浏览器前被拒绝", async () => {
  const read = vi.spyOn(Vault.prototype, "read");
  const state = {
    id: "ynjy",
    sources: [
      {
        url: "https://jsjks.ynjy.cn/classrooms/1/%73ubmit",
        course: "测试",
        type: "homework",
      },
    ],
  } as PlatformState;
  const result = await new Adapters("unused-security-test-dir").scan(state);
  expect(result.outcome).toBe("failed");
  expect(result.issues).toContain("监控来源地址无效，请使用官方任务列表页");
  expect(read).not.toHaveBeenCalled();
});
