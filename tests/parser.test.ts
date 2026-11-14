import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parsePage, parseTime } from "../packages/adapters/src/parser.js";
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");
it("中国时区解析与当前机器时区无关；非法日期保持未知", () => {
  expect(parseTime("2026-11-12 08:00")).toMatchObject({
    kind: "known",
    value: Date.parse("2026-11-12T00:00:00Z"),
  });
  expect(parseTime("2026-02-30 08:00").kind).toBe("unknown");
  expect(parseTime("2026-11-12 25:00").kind).toBe("unknown");
  expect(parseTime("明天").kind).toBe("unknown");
  expect(parseTime("无截止时间").kind).toBe("none");
});
it("jsjks 合成页面不把开放阶段或零进度当提交状态", () => {
  const r = parsePage("ynjy", fixture("ynjy-list"), {
    url: "https://jsjks.ynjy.cn/classrooms/example-class/program_homework",
    course: "实验课程",
    type: "homework",
  });
  expect(r.items).toHaveLength(1);
  expect(r.items[0].sourceStatus).toBe("unknown");
  expect(r.items[0].publishTime.kind).toBe("unknown");
  expect(r.items[0].deadline.kind).toBe("known");
  expect(r.paginationComplete).toBe(false);
});
it("人卫按列名读取时间，序号不作为 ID", () => {
  const r = parsePage("renwei", fixture("renwei-list"), {
    url: "https://tk.ipmph.com/exam/a/exam/examTask",
    course: "医学",
    type: "homework",
  });
  expect(r.items[0].sourceId).toBe("synthetic-id-1");
  expect(r.items[0].sourceStatus).toBe("submitted");
  expect(r.items[0].publishTime.kind).toBe("unknown");
  const missing = fixture("renwei-list")
    .replace('data-id="synthetic-id-1"', "")
    .replace("?id=synthetic-id-1", "");
  expect(
    parsePage("renwei", missing, {
      url: "https://tk.ipmph.com/exam/a/exam/examTask",
      course: "医学",
      type: "homework",
    }).items,
  ).toHaveLength(0);
});
it("HTTP 200 登录页和无法识别结构不当成合法空快照", () => {
  const s = {
    url: "https://tk.ipmph.com/exam/a/exam/examTask",
    course: "医学",
    type: "homework" as const,
  };
  expect(parsePage("renwei", '<input type="password">', s).auth).toBe(true);
  expect(parsePage("renwei", "<body>系统错误</body>", s).emptyConfirmed).toBe(
    false,
  );
});
it("多条任务混在父容器中时不借用相邻任务截止时间", () => {
  const html =
    '<body>退出 教学课堂<div><a href="/classrooms/c/program_homework/1/detail">无时间任务</a><a href="/classrooms/c/program_homework/2/detail">另一任务</a><p>2026-11-12 08:00 至 2026-11-15 23:59</p></div></body>';
  const r = parsePage("ynjy", html, {
    url: "https://jsjks.ynjy.cn/classrooms/c/program_homework",
    course: "test",
    type: "homework",
  });
  expect(r.items).toHaveLength(2);
  expect(r.items.every((t) => t.deadline.kind === "unknown")).toBe(true);
});

it("人卫真实行结构读取 examStudent ID，未完成不误判为已完成，安全验证脚本不覆盖已登录导航", () => {
  const shell = '<nav><a href="/exam/a/exam/exam/myExamList">我的考试</a><a href="/exam/a/exam/examTask/myExamTaskList">我的作业</a></nav>';
  const html = `<body>${shell}<div hidden>安全验证</div><table><thead><tr><th>考试名称</th><th>所属学科</th><th>开始时间</th><th>状态</th></tr></thead><tbody><tr id="examStudent_synthetic-stable"><td>考试样例</td><td>学科样例</td><td>2026-11-12\n 10:30</td><td>已结束</td></tr></tbody></table></body>`;
  const r = parsePage('renwei', html, {url:'https://tk.ipmph.com/exam/a/exam/exam/myExamList', course:'我的考试',type:'exam'});
  expect(r.verification).toBe(false);
  expect(r.items).toHaveLength(1);
  expect(r.items[0]).toMatchObject({sourceId:'synthetic-stable',type:'exam',sourceStatus:'unknown',deadline:{kind:'unknown'},startTime:{kind:'known'},url:'https://tk.ipmph.com/exam/a/exam/exam/myExamList'});
});
