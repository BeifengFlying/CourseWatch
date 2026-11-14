import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("macOS 继续发送 WebKit 消息", async () => {
  const postMessage = vi.fn();
  vi.stubGlobal("window", { webkit: { messageHandlers: { coursewatch: { postMessage } } } });
  const bridge = await import("../apps/extension/lib/desktop");
  bridge.sendDesktop("openPlatform", { platform: "renwei" });
  expect(bridge.desktopPlatform).toBe("macos");
  expect(postMessage).toHaveBeenCalledWith({ action: "openPlatform", platform: "renwei" });
});

it("Windows 使用 WebView2，消息详情不能覆盖操作名", async () => {
  const postMessage = vi.fn();
  vi.stubGlobal("window", { __coursewatchPlatform: "windows", chrome: { webview: { postMessage } } });
  const bridge = await import("../apps/extension/lib/desktop");
  bridge.sendDesktop("close", { action: "openExternal" });
  expect(bridge.desktopPlatform).toBe("windows");
  expect(bridge.isDesktop).toBe(true);
  expect(postMessage).toHaveBeenCalledWith({ action: "close" });
});

it("普通浏览器不会调用原生接口", async () => {
  vi.stubGlobal("window", {});
  const bridge = await import("../apps/extension/lib/desktop");
  expect(bridge.isDesktop).toBe(false);
  expect(() => bridge.sendDesktop("close")).not.toThrow();
});
