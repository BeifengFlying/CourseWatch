import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export class BrowserUnavailableError extends Error {}

export type BrowserSelection = "auto" | "chrome" | "edge";

// Chromium's update-time app clone can trigger macOS App Management checks
// under the parent app's identity. Only disable this optional clone; keep TCC
// protections and the user's installed browser unchanged.
export const browserStartupArgs = (platform = process.platform): string[] =>
  platform === "darwin" ? ["--disable-features=MacAppCodeSignClone"] : [];

// Only select an executable. The caller always supplies CourseWatch's own
// profile; the user's ordinary browser profile is never opened or imported.
export async function browserLaunchOptions({
  selection = process.env.COURSEWATCH_BROWSER || "auto",
  platform = process.platform,
  home = homedir(),
  environment = process.env,
  executableExists = async (path: string) => {
    try {
      await access(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
}: {
  selection?: string;
  platform?: NodeJS.Platform;
  home?: string;
  environment?: NodeJS.ProcessEnv;
  executableExists?: (path: string) => Promise<boolean>;
} = {}): Promise<{ executablePath: string; args?: string[] }> {
  if (!["auto", "chrome", "edge"].includes(selection)) throw new BrowserUnavailableError("浏览器设置无效，请在设置中重新选择");
  const candidates = [
    { id: "chrome", bundle: "Google Chrome.app", executable: "Google Chrome", windows: "Google/Chrome/Application/chrome.exe" },
    { id: "edge", bundle: "Microsoft Edge.app", executable: "Microsoft Edge", windows: "Microsoft/Edge/Application/msedge.exe" },
  ].filter(browser => selection === "auto" || browser.id === selection);
  if (platform === 'win32') {
    const roots = [environment.ProgramFiles || 'C:\\Program Files', environment['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', environment.LOCALAPPDATA || win32.join(home, 'AppData', 'Local')];
    for (const browser of candidates) for (const root of roots) {
      const path = win32.join(root, browser.windows);
      if (await executableExists(path)) return {executablePath:path};
    }
  }
  if (platform === 'darwin') for (const browser of candidates) {
    for (const directory of ["/Applications", posix.join(home, "Applications")]) {
      const path = posix.join(directory, browser.bundle, "Contents", "MacOS", browser.executable);
      if (await executableExists(path)) return { executablePath: path, args: browserStartupArgs(platform) };
    }
  }
  throw new BrowserUnavailableError(
    selection === "auto"
      ? "请先安装 Google Chrome 或 Microsoft Edge，再打开登录窗口。CourseWatch 使用独立登录目录。"
      : `未找到 ${selection === "chrome" ? "Google Chrome" : "Microsoft Edge"}，请先安装，或在设置中切换浏览器。`,
  );
}
