import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createECDH } from "node:crypto";
import nodemailer from "nodemailer";
import * as webpush from "web-push";
import { createServer } from "../apps/local-service/src/server.js";
import {
  defaultMobileNotifications,
  safePushEndpoint,
} from "../packages/contracts/src/mobile-notifications.js";
import type { SecretStorage } from "../packages/notifications/src/mobile.js";

vi.mock("web-push", async (original) => ({
  ...(await original<typeof import("web-push")>()),
  sendNotification: vi.fn(async () => ({ statusCode: 201 })),
}));
let dir: string,
  server: Awaited<ReturnType<typeof createServer>>,
  memory: Record<string, any>;
const token = "n".repeat(64),
  host = { host: "127.0.0.1:17321" };
const headers = {
  ...host,
  authorization: `Bearer ${token}`,
  origin: "http://127.0.0.1:17321",
};
const request = (
  url: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  payload?: any,
) =>
  server.app.inject({
    url,
    method,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
const config = () => ({
  ...structuredClone(defaultMobileNotifications),
  email: {
    enabled: true,
    host: "smtp.example.com",
    port: 465 as const,
    user: "from@example.com",
    from: "from@example.com",
    to: "to@example.net",
  },
  web: {
    enabled: true,
    pageUrl: "https://notify.example.org/mobile-push/",
    contact: "from@example.com",
  },
});
const save = (
  value = config(),
  password: string | undefined = "secret-authorization-code",
) =>
  request("/api/notification-channels", "PATCH", {
    config: value,
    ...(password ? { password } : {}),
  });
const rows = () =>
  server.store.all<any>(
    "SELECT * FROM notification_deliveries ORDER BY outbox_id,channel,target",
  );
async function connect() {
  const pairing = (
    await request("/api/notification-channels/pairing", "POST", {})
  ).json();
  const code = JSON.parse(Buffer.from(pairing.code, "base64url").toString());
  const key = createECDH("prime256v1");
  key.generateKeys();
  const body = {
    version: 1,
    nonce: code.nonce,
    publicKey: code.publicKey,
    name: "测试 iPad",
    subscription: {
      endpoint: "https://web.push.apple.com/fixture-device",
      keys: {
        p256dh: key.getPublicKey().toString("base64url"),
        auth: Buffer.alloc(16, 9).toString("base64url"),
      },
    },
  };
  expect(
    (await request("/api/notification-channels/devices", "POST", body))
      .statusCode,
  ).toBe(200);
  return { pairing, body };
}
beforeEach(async () => {
  vi.stubEnv("COURSEWATCH_NATIVE_TOKEN", token);
  vi.stubEnv("COURSEWATCH_NATIVE_NOTIFICATIONS", "1");
  dir = mkdtempSync(join(tmpdir(), "cw-mobile-"));
  memory = {};
  const secrets: SecretStorage = {
    read: async (id) => structuredClone(memory[id]),
    save: async (id, value) => {
      memory[id] = structuredClone(value);
    },
  };
  server = await createServer({
    dir,
    test: true,
    notificationSecrets: secrets,
  });
  vi.mocked(webpush.sendNotification)
    .mockReset()
    .mockResolvedValue({ statusCode: 201, body: "", headers: {} });
});
afterEach(async () => {
  await server.app.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("通知配置需要认证，日历原生接口拒绝普通配对客户端", async () => {
  expect(
    (
      await server.app.inject({
        url: "/api/notification-channels",
        headers: host,
      })
    ).statusCode,
  ).toBe(401);
  const pair = await server.app.inject({
    url: "/api/pair",
    method: "POST",
    headers: host,
    payload: { code: server.pairingCode },
  });
  expect(
    (
      await server.app.inject({
        url: "/api/native/calendar",
        headers: { ...host, authorization: `Bearer ${pair.json().token}` },
      })
    ).statusCode,
  ).toBe(403);
});
it("强制两个不同邮箱，凭据不写入配置、数据库或返回值，更换发件身份要求新凭据", async () => {
  const same = config();
  same.email.to = "FROM@example.com";
  const rejected = await save(same);
  expect(rejected.statusCode).toBe(400);
  expect(rejected.json().error).toContain("必须不同");
  const result = await save();
  expect(result.statusCode).toBe(200);
  expect(result.json().hasPassword).toBe(true);
  expect(result.body).not.toContain("secret-authorization-code");
  expect(
    JSON.stringify(server.store.all("SELECT * FROM settings")),
  ).not.toContain("secret-authorization-code");
  expect(memory["notification-secrets"].password).toBe(
    "secret-authorization-code",
  );
  expect((await save(config(), "")).statusCode).toBe(200);
  const changed = config();
  changed.email.host = "smtp.other.example";
  expect((await save(changed, "")).statusCode).toBe(400);
  expect((await request("/api/export")).body).not.toContain(
    "secret-authorization-code",
  );
});
it("关闭默认通知渠道不补发历史通知，配对码一次有效且私钥和订阅端点不回显", async () => {
  server.engine.enqueue("old", "旧通知", "过去", null, "new");
  await save();
  const { body, pairing } = await connect();
  expect(pairing.qr).toMatch(/^data:image\/png;base64,/);
  expect(pairing.url).toContain("#config=");
  expect(
    (await request("/api/notification-channels/devices", "POST", body))
      .statusCode,
  ).toBe(400);
  const visible = await request("/api/notification-channels");
  expect(visible.body).not.toContain(
    memory["notification-secrets"].vapid.privateKey,
  );
  expect(visible.body).not.toContain("fixture-device");
  expect(rows()).toHaveLength(0);
  server.engine.enqueue("new", "作业", "新作业", null, "new");
  server.engine.enqueue("new", "作业", "新作业", null, "new");
  expect(rows()).toHaveLength(2);
});
it("电脑通知关闭或已确认仍发送邮件和网页推送，一次接收后不重复投递", async () => {
  await save();
  await connect();
  const mail = vi
    .spyOn(server.mobileNotifications, "sendEmail")
    .mockResolvedValue();
  server.engine.enqueue("event", "作业提醒", "课程内容", null, "new");
  server.store.run(
    "UPDATE outbox SET delivered_at=?,error='系统通知关闭'",
    Date.now(),
  );
  await server.mobileNotifications.drain(server.engine);
  expect(mail).toHaveBeenCalledTimes(1);
  expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
  expect(rows().every((r) => r.status === "accepted")).toBe(true);
  await server.mobileNotifications.drain(server.engine);
  expect(mail).toHaveBeenCalledTimes(1);
});
it("一个渠道失败不阻止另一个渠道，邮件重试有退避及次数上限", async () => {
  await save();
  await connect();
  const mail = vi
    .spyOn(server.mobileNotifications, "sendEmail")
    .mockRejectedValue(new Error("smtp failure with secret"));
  server.engine.enqueue("retry", "通知", "内容", null, "new");
  await server.mobileNotifications.drain(server.engine);
  expect(rows().find((r) => r.channel === "web").status).toBe("accepted");
  expect(rows().find((r) => r.channel === "email")).toMatchObject({
    status: "pending",
    attempts: 1,
  });
  expect(JSON.stringify(rows())).not.toContain("smtp failure with secret");
  await server.mobileNotifications.drain(server.engine);
  expect(mail).toHaveBeenCalledTimes(1);
  for (let n = 0; n < 2; n++) {
    server.store.run("UPDATE notification_deliveries SET next_attempt=0");
    await server.mobileNotifications.drain(server.engine);
  }
  expect(rows().find((r) => r.channel === "email")).toMatchObject({
    status: "failed",
    attempts: 3,
  });
});
it("已发电脑通知的日程标记完成后，取消尚未发送的远端提醒", async () => {
  await save();
  await connect();
  const now = Date.now();
  server.engine.saveSchedule({
    id: "agenda",
    title: "汇报",
    note: "",
    dueAt: now + 60000,
    done: false,
    version: 1,
    updatedAt: now,
    important: false,
    reminderHours: [1],
  });
  server.engine.reminders(now);
  server.store.run("UPDATE outbox SET delivered_at=?", now);
  server.engine.saveSchedule({ ...server.engine.schedules()[0], done: true });
  const mail = vi
    .spyOn(server.mobileNotifications, "sendEmail")
    .mockResolvedValue();
  await server.mobileNotifications.drain(server.engine);
  expect(rows().every((r) => r.status === "cancelled")).toBe(true);
  expect(mail).not.toHaveBeenCalled();
  expect(webpush.sendNotification).not.toHaveBeenCalled();
});
it("失效订阅只移除对应设备，关闭渠道取消待发送记录，过期消息不补发", async () => {
  await save();
  await connect();
  vi.mocked(webpush.sendNotification).mockRejectedValueOnce(
    Object.assign(new Error("gone"), { statusCode: 410 }),
  );
  vi.spyOn(server.mobileNotifications, "sendEmail").mockResolvedValue();
  server.engine.enqueue("gone", "通知", "内容", null, "new");
  await server.mobileNotifications.drain(server.engine);
  expect(
    (await request("/api/notification-channels")).json().devices,
  ).toHaveLength(0);
  expect(rows().find((r) => r.channel === "web").status).toBe("failed");
  server.engine.enqueue(
    "expired",
    "旧通知",
    "内容",
    null,
    "new",
    Date.now() - 2 * 86400000,
  );
  await server.mobileNotifications.drain(server.engine);
  expect(rows().at(-1).status).toBe("cancelled");
  server.engine.enqueue("disable", "待发送", "内容", null, "new");
  const disabled = config();
  disabled.email.enabled = false;
  await save(disabled, "");
  expect(rows().at(-1).status).toBe("cancelled");
});
it("不接受私网、带账号、伪造域名或非 HTTPS 的推送端点", async () => {
  for (const endpoint of [
    "http://web.push.apple.com/x",
    "https://127.0.0.1/x",
    "https://web.push.apple.com.evil.example/x",
    "https://user@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:444/x",
  ])
    expect(safePushEndpoint(endpoint)).toBe(false);
  expect(safePushEndpoint("https://fcm.googleapis.com/fcm/send/fixture")).toBe(
    true,
  );
});
it("清除通知会删除渠道记录，SQLite 复用通知编号时不继承旧投递状态", async () => {
  await save();
  server.engine.enqueue("first", "旧通知", "内容", null, "new");
  server.store.run(
    "UPDATE notification_deliveries SET status='accepted',attempts=2",
  );
  server.store.run("DELETE FROM outbox");
  expect(rows()).toHaveLength(0);
  server.engine.enqueue("second", "新通知", "内容", null, "new");
  expect(rows()).toHaveLength(1);
  expect(rows()[0]).toMatchObject({ status: "pending", attempts: 0 });
});
it("请求发送期间拒绝更换凭据，已选批次中的后续提醒取消后不发送", async () => {
  await save();
  await connect();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mail = vi
    .spyOn(server.mobileNotifications, "sendEmail")
    .mockReturnValue(pending);
  server.engine.enqueue(
    "in-flight",
    "提醒",
    "内容",
    "cancel-during-send",
    "deadline",
  );
  const drain = server.mobileNotifications.drain(server.engine);
  await vi.waitFor(() => expect(mail).toHaveBeenCalledTimes(1));
  const changed = config();
  changed.email.host = "smtp.changed.example";
  expect((await save(changed)).statusCode).toBe(409);
  expect(server.store.get<any>("mobileNotifications", {}).email.host).toBe(
    "smtp.example.com",
  );
  server.engine.cancelPendingDeadlines("cancel-during-send", "事项已完成");
  release();
  await drain;
  expect(webpush.sendNotification).not.toHaveBeenCalled();
  expect(rows().find((r) => r.channel === "web").status).toBe("cancelled");
});
it("SMTP 使用加密连接，确认接收后才报告成功，测试邮件不会写入正常通知队列", async () => {
  await save();
  const sendMail = vi.fn().mockResolvedValue({ accepted: ["to@example.net"] });
  const close = vi.fn();
  const createTransport = vi
    .spyOn(nodemailer, "createTransport")
    .mockReturnValue({ sendMail, close } as any);
  const result = await request("/api/notification-channels/test", "POST", {
    channel: "email",
  });
  expect(result.statusCode).toBe(200);
  expect(result.json().message).toContain("可能延迟");
  expect(createTransport).toHaveBeenCalledWith(
    expect.objectContaining({
      secure: true,
      port: 465,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    }),
  );
  expect(sendMail).toHaveBeenCalledWith(
    expect.objectContaining({
      to: "to@example.net",
      from: { name: "CourseWatch", address: "from@example.com" },
    }),
  );
  expect(close).toHaveBeenCalled();
  expect(rows()).toHaveLength(0);
  sendMail.mockResolvedValueOnce({ accepted: [] });
  expect(
    (
      await request("/api/notification-channels/test", "POST", {
        channel: "email",
      })
    ).statusCode,
  ).toBe(409);
});
it("日历快照只含未完成、有时间的事项，更新与删除改变版本，拒绝旧版本确认", async () => {
  const settings = config();
  settings.calendar.enabled = process.platform === "darwin";
  await save(settings);
  // The projection is platform-independent; permission and EventKit writes are native-only.
  server.store.set("mobileNotifications", {
    ...settings,
    calendar: { enabled: true },
  });
  const now = Date.now();
  server.engine.saveSchedule({
    id: "calendar",
    title: "汇报",
    note: "带电脑",
    dueAt: now + 3600000,
    done: false,
    version: 1,
    updatedAt: now,
    important: false,
    reminderHours: [0.5],
  });
  const first = (await request("/api/native/calendar")).json();
  expect(first.items).toHaveLength(1);
  expect(first.items[0]).toMatchObject({
    id: "calendar",
    notes: "带电脑",
    reminderHours: [0.5, 0],
  });
  server.engine.deleteSchedule("calendar");
  expect((await request("/api/native/calendar")).json().items).toHaveLength(0);
  expect(
    (
      await request("/api/native/calendar/status", "POST", {
        revision: first.revision,
        ok: true,
        message: "旧结果",
      })
    ).statusCode,
  ).toBe(409);
});
