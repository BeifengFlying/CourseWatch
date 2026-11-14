import { describe, expect, it } from "vitest";
import {
  browserLaunchOptions,
  BrowserUnavailableError,
  browserStartupArgs,
} from "../packages/adapters/src/browser.js";

describe("精简版浏览器选择", () => {
  it("本机 Chrome 只用可执行文件，不选择日常资料目录", async () => {
    const result = await browserLaunchOptions({
      platform: "darwin",
      home: "/Users/test",
      executableExists: async (path) =>
        path === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
    expect(result).toEqual({
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      args: browserStartupArgs("darwin"),
    });
  });
  it("Chrome 缺失时选择用户 Applications 中的 Edge", async () => {
    const edge =
      "/Users/test/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
    expect(
      await browserLaunchOptions({
        platform: "darwin",
        home: "/Users/test",
        executableExists: async (path) => path === edge,
      }),
    ).toEqual({ executablePath: edge, args: browserStartupArgs("darwin") });
  });
  it("没有浏览器时给出可操作的提示，不悄悄下载", async () => {
    await expect(
      browserLaunchOptions({
        platform: "darwin",
        executableExists: async () => false,
      }),
    ).rejects.toThrow(BrowserUnavailableError);
  });

});

it('Windows 无内置浏览器时使用本机 Edge，缺失时给出安装提示', async()=>{
 const edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
 expect(await browserLaunchOptions({platform:'win32',environment:{},executableExists:async path=>path===edge})).toEqual({executablePath:edge});
 await expect(browserLaunchOptions({platform:'win32',environment:{},executableExists:async()=>false})).rejects.toThrow('请先安装');
});

it('明确选择 Edge 时不尝试 Chrome，未安装时不回退', async () => {
 const visited: string[] = [];
 const edge='/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
 expect(await browserLaunchOptions({platform:'darwin',selection:'edge',executableExists:async path=>{visited.push(path);return path===edge;}})).toEqual({executablePath:edge,args:browserStartupArgs('darwin')});
 expect(visited.every(path=>path.includes('Microsoft Edge'))).toBe(true);
 await expect(browserLaunchOptions({platform:'darwin',selection:'edge',executableExists:async path=>path.includes('Google Chrome')})).rejects.toThrow('未找到 Microsoft Edge');
});
it('自动选择优先用户目录 Chrome，明确选择 Windows Edge 时不回退', async () => {
 const chrome='/Users/test/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 expect((await browserLaunchOptions({platform:'darwin',home:'/Users/test',selection:'auto',executableExists:async path=>path===chrome||path.includes('Microsoft Edge')})).executablePath).toBe(chrome);
 await expect(browserLaunchOptions({platform:'win32',selection:'edge',environment:{},executableExists:async path=>path.includes('Google')})).rejects.toThrow('未找到 Microsoft Edge');
});
it('macOS 关闭更新签名副本，其他平台不添加此参数', () => {
 expect(browserStartupArgs('darwin')).toContain('--disable-features=MacAppCodeSignClone');
 expect(browserStartupArgs('win32')).toEqual([]);
});
