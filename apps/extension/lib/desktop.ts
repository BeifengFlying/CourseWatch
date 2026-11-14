interface DesktopMessage {
  action: string;
  [key: string]: unknown;
}

export interface DesktopPreferences {
  setupCompleted: boolean;
  backgroundEnabled: boolean;
  launchAtLogin: boolean;
  closeBehavior: "ask" | "tray" | "quit";
}

type DesktopWindow = Window & {
  webkit?: { messageHandlers?: { coursewatch?: { postMessage(message: DesktopMessage): void } } };
  chrome?: { webview?: { postMessage(message: DesktopMessage): void } };
  __coursewatchPlatform?: "windows";
};

const host = window as DesktopWindow;
export const desktopPlatform = host.__coursewatchPlatform === "windows"
  ? "windows"
  : host.webkit?.messageHandlers?.coursewatch ? "macos" : "browser";
export const isDesktop = desktopPlatform !== "browser";
export function sendDesktop(action: string, detail: Record<string, unknown> = {}) {
  const message = { ...detail, action };
  if (desktopPlatform === "windows") host.chrome?.webview?.postMessage(message);
  else host.webkit?.messageHandlers?.coursewatch?.postMessage(message);
}
