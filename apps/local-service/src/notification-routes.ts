import type { FastifyInstance } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import QRCode from "qrcode";
import type { Engine } from "../../../packages/core/src/index.js";
import { agendaEntries } from "../../../packages/contracts/src/agenda.js";
import {
  BrowserSubscription,
  MobileNotificationConfig,
} from "../../../packages/contracts/src/mobile-notifications.js";
import {
  MobileNotifications,
  mobileConfig,
  pushDevices,
  type SecretStorage,
} from "../../../packages/notifications/src/mobile.js";

export function registerNotificationRoutes(
  app: FastifyInstance,
  engine: Engine,
  dir: string,
  secrets?: SecretStorage,
) {
  const store = engine.store;
  const mobile = secrets
    ? new MobileNotifications(store, secrets)
    : MobileNotifications.local(store, dir);
  let saving = false;
  const view = () => ({
    config: mobileConfig(store),
    hasPassword: store.get("notificationPasswordSaved", false),
    devices: pushDevices(store),
    calendarSupported: process.platform === "darwin",
    calendarStatus: store.get("calendarStatus", {
      message: "尚未同步",
      at: null,
    }),
    deliveries: store.all(
      "SELECT d.*,o.title FROM notification_deliveries d LEFT JOIN outbox o ON o.id=d.outbox_id ORDER BY d.outbox_id DESC LIMIT 30",
    ),
  });
  app.get("/api/notification-channels", view);
  app.patch("/api/notification-channels", async (req, reply) => {
    const parsed = z
      .object({
        config: MobileNotificationConfig,
        password: z.string().max(500).optional(),
        clearPassword: z.boolean().optional(),
      })
      .strict()
      .safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({
        error:
          parsed.error.issues.find((i) => i.code === "custom")?.message ??
          "请检查通知设置、邮箱地址和 SMTP 端口",
      });
    const input = parsed.data;
    const previous = mobileConfig(store);
    if (saving)
      return reply.code(409).send({ error: "通知设置正在保存，请稍后重试" });
    if (mobile.delivering)
      return reply.code(409).send({ error: "通知正在投递，请稍后保存设置" });
    if (input.config.calendar.enabled && process.platform !== "darwin")
      return reply
        .code(400)
        .send({ error: "iCloud 日历同步仅支持 macOS 桌面端" });
    const identityChanged = (["host", "user", "from"] as const).some(
      (k) => previous.email[k] !== input.config.email[k],
    );
    if (
      input.config.email.enabled &&
      !input.password &&
      (input.clearPassword ||
        identityChanged ||
        !store.get("notificationPasswordSaved", false))
    )
      return reply.code(400).send({
        error:
          "请填写发件邮箱的 SMTP 授权码；更换服务器或发件账号后需要重新填写",
      });
    saving = true;
    mobile.configuring = true;
    try {
      if (input.password || input.clearPassword || identityChanged) {
        await mobile.updateSecrets((s) => ({
          ...s,
          password: input.password || undefined,
        }));
        store.set("notificationPasswordSaved", !!input.password);
      }
      store.db.transaction(() => {
        for (const channel of ["email", "web"] as const)
          if (
            JSON.stringify(previous[channel]) !==
              JSON.stringify(input.config[channel]) ||
            (channel === "email" && input.password)
          )
            mobile.cancel(channel, "通知设置已更改，旧投递已取消");
        store.set("mobileNotifications", input.config);
        store.run("DELETE FROM settings WHERE key='pushPairing'");
      })();
      return view();
    } catch {
      return reply
        .code(409)
        .send({ error: "无法保存系统凭据，请检查钥匙串或 Windows 凭据权限" });
    } finally {
      saving = false;
      mobile.configuring = false;
    }
  });
  app.post("/api/notification-channels/test", async (req, reply) => {
    const { channel } = z
      .object({ channel: z.enum(["email", "web"]) })
      .strict()
      .parse(req.body);
    if (mobile.delivering || mobile.configuring)
      return reply.code(409).send({ error: "通知正在投递或保存，请稍后测试" });
    try {
      await mobile.test(channel);
      return {
        ok: true,
        message:
          channel === "email"
            ? "发件服务器已接收测试邮件；收件与手机提示可能延迟，请检查收件箱和垃圾邮件"
            : "推送服务已接收测试通知，请在手机或 iPad 上核对",
      };
    } catch {
      return reply.code(409).send({
        error:
          channel === "email"
            ? "测试邮件未确认发送，请检查双邮箱、SMTP 地址、端口及授权码"
            : "测试推送未确认发送，请检查设备订阅、网络及通知权限",
      });
    }
  });
  app.post("/api/notification-channels/pairing", async (_, reply) => {
    const config = mobileConfig(store);
    if (!config.web.enabled)
      return reply.code(400).send({ error: "请先填写并保存网页推送设置" });
    try {
      const publicKey = await mobile.publicKey();
      const pairing = {
        nonce: randomBytes(24).toString("base64url"),
        expiresAt: Date.now() + 30 * 60000,
        publicKey,
      };
      store.set("pushPairing", pairing);
      const code = Buffer.from(JSON.stringify(pairing)).toString("base64url");
      const url = `${config.web.pageUrl}#config=${code}`;
      return {
        url,
        code,
        expiresAt: pairing.expiresAt,
        qr: await QRCode.toDataURL(url, { width: 280, margin: 2 }),
      };
    } catch {
      return reply
        .code(409)
        .send({ error: "无法创建推送密钥，请检查系统凭据权限" });
    }
  });
  app.post("/api/notification-channels/devices", async (req, reply) => {
    const input = z
      .object({
        version: z.literal(1),
        nonce: z.string().max(100),
        publicKey: z.string().max(100),
        name: z.string().trim().min(1).max(80),
        subscription: BrowserSubscription,
      })
      .strict()
      .parse(req.body);
    const pairing = store.get<{
      nonce: string;
      expiresAt: number;
      publicKey: string;
    } | null>("pushPairing", null);
    if (
      !pairing ||
      pairing.expiresAt < Date.now() ||
      pairing.nonce !== input.nonce ||
      pairing.publicKey !== input.publicKey
    )
      return reply
        .code(400)
        .send({ error: "配对信息已失效，请在电脑上重新生成" });
    if (saving) return reply.code(409).send({ error: "正在保存，请稍后重试" });
    saving = true;
    try {
      const known = (await mobile.readSecrets()).subscriptions ?? {};
      if (
        pushDevices(store).length >= 12 &&
        !Object.values(known).some(
          (s) => s.endpoint === input.subscription.endpoint,
        )
      )
        return reply
          .code(400)
          .send({ error: "最多连接 12 台设备，请先移除不用的设备" });
      const id = randomUUID();
      // Re-importing the same browser replaces its old record rather than sending twice.
      let replaced: string[] = [];
      await mobile.updateSecrets((s) => {
        const subscriptions = { ...s.subscriptions };
        replaced = Object.keys(subscriptions).filter(
          (key) => subscriptions[key].endpoint === input.subscription.endpoint,
        );
        for (const key of replaced) delete subscriptions[key];
        return {
          ...s,
          subscriptions: { ...subscriptions, [id]: input.subscription },
        };
      });
      for (const key of replaced)
        store.run(
          "UPDATE notification_deliveries SET status='cancelled',error='设备已重新连接' WHERE channel='web' AND target=? AND status='pending'",
          key,
        );
      store.set("pushDevices", [
        ...pushDevices(store).filter((d) => !replaced.includes(d.id)),
        { id, name: input.name, createdAt: Date.now() },
      ]);
      store.run("DELETE FROM settings WHERE key='pushPairing'");
      return view();
    } catch {
      return reply
        .code(409)
        .send({ error: "设备订阅未保存，请检查系统凭据权限" });
    } finally {
      saving = false;
    }
  });
  app.post<{ Params: { id: string } }>(
    "/api/notification-channels/devices/:id/delete",
    async (req, reply) => {
      const id = z.uuid().parse(req.params.id);
      if (saving)
        return reply.code(409).send({ error: "正在保存，请稍后重试" });
      saving = true;
      try {
        await mobile.updateSecrets((s) => {
          const subscriptions = { ...s.subscriptions };
          delete subscriptions[id];
          return { ...s, subscriptions };
        });
        store.set(
          "pushDevices",
          pushDevices(store).filter((d) => d.id !== id),
        );
        store.run(
          "UPDATE notification_deliveries SET status='cancelled',error='设备已移除' WHERE channel='web' AND target=? AND status='pending'",
          id,
        );
        return view();
      } catch {
        return reply
          .code(409)
          .send({ error: "设备未移除，请检查系统凭据权限" });
      } finally {
        saving = false;
      }
    },
  );
  const snapshot = () => {
    const enabled = mobileConfig(store).calendar.enabled;
    const items = enabled
      ? agendaEntries(
          engine.visibleTasks().filter((t) => !engine.initiallyExpired(t)),
          engine.schedules(),
        )
          .filter(
            (t) =>
              !t.done &&
              t.dueAt !== null &&
              t.dueAt >= Date.now() - 30 * 86400000,
          )
          .map((t) => ({
            id: t.id,
            title: t.title,
            notes: [t.subtitle, t.task?.url].filter(Boolean).join("\n"),
            dueAt: t.dueAt!,
            reminderHours: [
              ...new Set([
                ...(t.reminderHours ?? engine.settings().reminderHours),
                0,
              ]),
            ],
          }))
          .sort((a, b) => a.id.localeCompare(b.id))
      : [];
    const data = { enabled, items };
    return {
      ...data,
      revision: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
    };
  };
  app.get("/api/native/calendar", snapshot);
  app.post("/api/native/calendar/status", (req, reply) => {
    const input = z
      .object({
        revision: z.string().regex(/^[a-f0-9]{64}$/),
        ok: z.boolean(),
        message: z.string().max(300),
      })
      .strict()
      .parse(req.body);
    if (input.revision !== snapshot().revision)
      return reply.code(409).send({ error: "日程已更新，等待下一轮同步" });
    store.set("calendarStatus", { ...input, at: Date.now() });
    return { ok: true };
  });
  return mobile;
}
