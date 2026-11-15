import { describe, it, expect, vi } from "vitest";
import type { BrowserContext } from "playwright";
import {
  confirmLogin,
  inspectSession,
} from "../packages/adapters/src/session.js";

const frame = (html: string, url = "https://tk.ipmph.com/exam/a/") => ({
  url: () => url,
  content: async () => html,
});
function context(
  pages: ReturnType<typeof frame>[][],
  response?: { html: string; url: string },
) {
  return {
    pages: () => pages.map((frames) => ({ frames: () => frames })),
    request: {
      get: vi.fn(async () => ({
        status: () => 200,
        ok: () => true,
        url: () => response?.url ?? "https://tk.ipmph.com/exam/a/adminlogin",
        text: async () => response?.html ?? '<input type="password">',
      })),
    },
  } as unknown as BrowserContext;
}

describe("登录识别与任务采集分离", () => {
  const accountShell = `<nav>
    <a href="/exam/a/exam/exam/myExamList">我的考试</a>
    <a href="https://tk.ipmph.com/exam/a/exam/examTask/myExamTaskList">我的作业</a>
    </nav><div class="captcha">拖动下方拼图完成验证 安全验证</div>`;
  it("人卫账号导航已加载时，验证码组件文字不覆盖已登录状态，无需任务内容", async () => {
    expect(inspectSession(accountShell, "renwei")).toMatchObject({
      authenticated: true, verification: false, login: false,
    });
    await expect(confirmLogin(context([[frame(accountShell)]]), "renwei"))
      .resolves.toBeUndefined();
  });
  it("人卫账号首页探测也允许页面内保留验证码组件", async () => {
    await expect(confirmLogin(context([[frame("<p>正在加载</p>")]], {
      html: accountShell, url: "https://tk.ipmph.com/exam/a/",
    }), "renwei")).resolves.toBeUndefined();
  });
  it("单个导航链接、外站链接或含密码表单不能被识别为人卫登录成功", () => {
    for (const html of [
      '<a href="/exam/a/exam/exam/myExamList">我的考试</a>',
      accountShell.replaceAll('href="/', 'href="https://example.com/').replace('https://tk.ipmph.com/', 'https://example.com/'),
      accountShell + '<input type="password">',
    ]) expect(inspectSession(html, "renwei").authenticated).toBe(false);
    expect(inspectSession(accountShell, "ynjy").authenticated).toBe(false);
  });
  it("账号首页有退出入口即可保存，无需出现任务或教学班", async () => {
    await expect(
      confirmLogin(
        context([[frame('<a href="/exam/a/logout" title="退出">退出</a>')]]),
        "renwei",
      ),
    ).resolves.toBeUndefined();
    expect(inspectSession("<button>退出系统</button>").authenticated).toBe(
      true,
    );
  });
  it("检查所有官方标签和框架，忽略最后一个未登录或第三方页面", async () => {
    const c = context([
      [
        frame("<iframe></iframe>"),
        frame(
          "<button>退出登录</button>",
          "https://tk.ipmph.com/exam/a/header",
        ),
      ],
      [
        frame(
          '<input type="password">',
          "https://tk.ipmph.com/exam/a/adminlogin",
        ),
      ],
      [frame("<button>退出登录</button>", "https://example.com/")],
    ]);
    await expect(confirmLogin(c, "renwei")).resolves.toBeUndefined();
  });
  it("浏览器无退出文字时以同一会话访问账号首页验证，不移动用户页面", async () => {
    const c = context([[frame("<div>欢迎使用</div>")]], {
      html: '<nav><a href="/exam/a/exam/examTask">我的作业</a></nav>',
      url: "https://tk.ipmph.com/exam/a/",
    });
    await expect(confirmLogin(c, "renwei")).resolves.toBeUndefined();
  });
  it("仅有 Cookie、登录表单、未知首页或其他域名的退出入口都不算成功", async () => {
    await expect(
      confirmLogin(context([[frame('<input type="password">')]]), "renwei"),
    ).rejects.toThrow("尚未确认");
    await expect(
      confirmLogin(
        context([[frame("<button>退出登录</button>", "https://example.com/")]]),
        "ynjy",
      ),
    ).rejects.toThrow("官方登录");
    await expect(
      confirmLogin(
        context([[frame("<div>欢迎</div>")]], {
          html: "<div>系统错误</div>",
          url: "https://tk.ipmph.com/exam/a/",
        }),
        "renwei",
      ),
    ).rejects.toThrow("尚未确认");
  });
  it("人工验证未完成时保留窗口并说明操作", async () => {
    await expect(
      confirmLogin(context([[frame("<div>请完成安全验证</div>")]]), "renwei"),
    ).rejects.toThrow("完成验证");
  });
  it("脚本、隐藏模板中的退出和登录控件不决定状态", () => {
    expect(
      inspectSession(
        '<script>退出登录</script><div hidden><a href="/logout">退出</a></div>',
      ).authenticated,
    ).toBe(false);
    expect(
      inspectSession(
        '<div style="display:none"><input type="password"></div><button>退出登录</button>',
      ),
    ).toMatchObject({ authenticated: true, login: false });
  });
});

it.each(["yuketang", "chaoxing"] as const)("%s 通过受保护接口确认登录，可接受真实结构的空课程", async (id) => {
  const get = vi.fn(async () => ({
    status: () => 200, ok: () => true, url: () => id === 'yuketang' ? 'https://www.yuketang.cn/api/v3/user/basic-info' : 'https://mooc1-api.chaoxing.com/mycourse/backclazzdata', headers: () => ({}), dispose: async () => {},
    text: async () => id === "yuketang" ? '{"code":0,"data":{"id":42}}' : '{"result":1,"channelList":[]}',
  }));
  const ctx = { request: { get }, cookies: async () => [], pages: () => [] } as unknown as BrowserContext;
  await expect(confirmLogin(ctx, id)).resolves.toBeUndefined();
  expect(get.mock.calls).toHaveLength(1);
});
it("学习通登录验证复用课程响应，不为课程发现重复发请求", async () => {
  const get = vi.fn(async () => ({status:()=>200,ok:()=>true,url:()=> 'https://mooc1-api.chaoxing.com/mycourse/backclazzdata',headers:()=>({}),dispose:async()=>{},
    text:async()=>JSON.stringify({result:1,channelList:[{content:{id:20,course:{data:[{id:10,name:"测试课程"}]}}}]})}));
  const onCourses = vi.fn();
  await confirmLogin({request:{get}} as unknown as BrowserContext,"chaoxing",onCourses);
  expect(get).toHaveBeenCalledTimes(1);
  expect(onCourses).toHaveBeenCalledWith([{key:"course:10:class:20",name:"测试课程"}]);
});
it.each(["yuketang", "chaoxing"] as const)("%s 只有退出文字或 Cookie，不足以保存登录", async (id) => {
  const ctx = {
    request: { get: async () => ({ status: () => 200, ok: () => true, url:()=> 'https://i.chaoxing.com/', headers: () => ({}), dispose: async () => {}, text: async () => '<input type="password">账号登录' }) },
    cookies: async () => [{ name: "sessionid", value: "fixture" }],
    pages: () => [{ frames: () => [{ url: () => id === "yuketang" ? 'https://www.yuketang.cn/web' : 'https://i.chaoxing.com/', content: async () => '<button>退出登录</button>' }] }],
  } as unknown as BrowserContext;
  await expect(confirmLogin(ctx, id)).rejects.toThrow("尚未确认登录成功");
});
