import type { APIRequestContext, APIResponse } from "playwright";
import {
  safePlatformReadUrl,
  type PlatformId,
} from "../../contracts/src/index.js";

// Automatic redirects send the next request before its URL can be checked.
// Validate each hop, including same-host operation paths, before sending it.
export async function getPlatformPage(
  client: Pick<APIRequestContext, "get">,
  platform: PlatformId,
  url: string,
  timeout = 20000,
  headers?: Record<string, string>,
): Promise<APIResponse> {
  const deadline = Date.now() + timeout;
  const origin = new URL(url).origin;
  for (let hop = 0; ; hop++) {
    if (!safePlatformReadUrl(platform, url))
      throw new Error("拒绝访问非官方页面或业务操作地址");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("页面请求超时");
    const response = await client.get(url, {
      maxRedirects: 0,
      timeout: remaining,
      ...(headers && new URL(url).origin === origin ? { headers } : {}),
    });
    if (![301, 302, 303, 307, 308].includes(response.status())) return response;
    const location = response.headers().location;
    if (!location) return response;
    await response.dispose();
    if (hop >= 5) throw new Error("页面重定向次数超过上限");
    url = new URL(location, url).href;
  }
}
