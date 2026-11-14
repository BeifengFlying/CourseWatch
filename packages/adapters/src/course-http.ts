import type { APIRequestContext } from "playwright";
import type {
  PlatformId,
  Partition,
  ScanResult,
} from "../../contracts/src/index.js";
import type { z } from "zod";
import { getPlatformPage } from "./http.js";
import { inspectSession } from "./session.js";

export class CollectionError extends Error {
  partial?: CollectedList;
  constructor(
    message: string,
    readonly outcome:
      "failed" | "auth_required" | "verification_required" = "failed",
    readonly stop = false,
  ) {
    super(message);
  }
}
export type ReadPage = (
  url: string,
  headers?: Record<string, string>,
) => Promise<string>;
export function courseReader(
  client: APIRequestContext,
  platform: PlatformId,
): ReadPage {
  const end = Date.now() + 90000;
  let requests = 0;
  return async (url, headers) => {
    if (++requests > 160 || Date.now() >= end)
      throw new CollectionError(
        "本轮达到请求数量或时间上限，未读取的课程保留旧任务",
        "failed",
        true,
      );
    const response = await getPlatformPage(
      client,
      platform,
      url,
      Math.min(15000, end - Date.now()),
      headers,
    );
    try {
      const status = response.status();
      if (status === 401)
        throw new CollectionError(
          "登录已失效，请重新登录",
          "auth_required",
          true,
        );
      if (status === 403)
        throw new CollectionError(
          "平台拒绝读取，请在官方窗口检查登录或验证要求",
          "verification_required",
          true,
        );
      if (status === 429)
        throw new CollectionError("平台限流，本轮已停止", "failed", true);
      if (!response.ok())
        throw new CollectionError("平台列表请求失败，旧任务已保留");
      if (Number(response.headers()["content-length"] || 0) > 4 * 1024 * 1024)
        throw new CollectionError("平台响应超过大小上限");
      const body = await response.text();
      if (body.length > 4 * 1024 * 1024)
        throw new CollectionError("平台响应超过大小上限");
      if (/^\s*</.test(body)) {
        const session = inspectSession(body, platform);
        if (session.verification)
          throw new CollectionError(
            "平台要求人工验证，请在官方窗口完成",
            "verification_required",
            true,
          );
        if (session.login || /扫码登录|微信扫码登录|登录后查看/.test(body))
          throw new CollectionError(
            "登录已失效，请重新登录",
            "auth_required",
            true,
          );
      }
      return body;
    } finally {
      await response.dispose();
    }
  };
}
export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new CollectionError("平台返回的内容不是预期的数据格式，旧任务已保留");
  }
}

export type CollectedList = Pick<
  z.infer<typeof Partition>,
  "items" | "emptyConfirmed" | "paginationComplete" | "issues"
>;
export class CourseScan {
  readonly result: ScanResult;
  constructor(platform: PlatformId, accountId: string) {
    this.result = {
      platform,
      accountId,
      outcome: "failed",
      discoveryComplete: false,
      partitions: [],
      issues: [],
    };
  }
  async partition(key: string, collect: () => Promise<CollectedList>) {
    if (this.result.partitions.length >= 90)
      throw new CollectionError(
        "课程分区达到本轮上限，未读取部分保留旧任务",
        "failed",
        true,
      );
    try {
      const list = await collect();
      this.result.partitions.push({
        key,
        outcome:
          list.items.length || list.emptyConfirmed ? "partial" : "failed",
        ...list,
      });
    } catch (error) {
      if (
        error instanceof CollectionError &&
        (error.stop || error.outcome !== "failed")
      ) {
        if (error.outcome === "failed" && error.partial) {
          const list = error.partial;
          this.result.partitions.push({
            key,
            outcome:
              list.items.length || list.emptyConfirmed ? "partial" : "failed",
            ...list,
          });
        }
        throw error;
      }
      this.result.partitions.push({
        key,
        outcome: "failed",
        items: [],
        emptyConfirmed: false,
        paginationComplete: false,
        issues: ["课程列表读取失败或结构无法识别，旧任务已保留"],
      });
    }
  }
  fail(error: unknown) {
    const issue =
      error instanceof CollectionError
        ? error.message
        : "课程列表读取失败或结构无法识别，旧任务已保留";
    this.result.issues.push(issue);
    if (error instanceof CollectionError && error.outcome !== "failed") {
      this.result.outcome = error.outcome;
      this.result.partitions = [];
    }
  }
  finish(): ScanResult {
    if (
      !["auth_required", "verification_required"].includes(this.result.outcome)
    )
      this.result.outcome = (this.result.courses !== undefined || this.result.partitions.some(
        (p) => p.items.length || p.emptyConfirmed,
      ))
        ? "partial"
        : "failed";
    this.result.issues = [
      ...this.result.issues,
      ...this.result.partitions.flatMap((p) => p.issues),
      "全部课程与分页覆盖尚未通过真实账号验证",
    ].slice(0, 30);
    return this.result;
  }
}
