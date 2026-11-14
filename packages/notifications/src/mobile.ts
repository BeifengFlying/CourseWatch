import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import * as webpush from "web-push";
import type { Engine } from "../../core/src/index.js";
import type { Store } from "../../storage/src/index.js";
import { Vault } from "../../adapters/src/vault.js";
import {
  defaultMobileNotifications,
  type MobileNotificationConfig,
  type PushDevice,
} from "../../contracts/src/mobile-notifications.js";

export interface NotificationSecrets {
  password?: string;
  vapid?: { publicKey: string; privateKey: string };
  subscriptions?: Record<string, webpush.PushSubscription>;
}
export interface SecretStorage {
  read(id: string): Promise<any>;
  save(id: string, value: unknown): Promise<void>;
}
export const mobileConfig = (store: Store) =>
  store.get<MobileNotificationConfig>(
    "mobileNotifications",
    defaultMobileNotifications,
  );
export const pushDevices = (store: Store) =>
  store.get<PushDevice[]>("pushDevices", []);
export class MobileNotifications {
  private active = false;
  configuring = false;
  get delivering() {
    return this.active;
  }
  private secrets?: NotificationSecrets;
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(
    public store: Store,
    private vault: SecretStorage,
  ) {}
  static local(store: Store, dir: string) {
    return new MobileNotifications(store, new Vault(dir));
  }
  async readSecrets(): Promise<NotificationSecrets> {
    return (this.secrets ??=
      (await this.vault.read("notification-secrets")) ?? {});
  }
  async updateSecrets(
    update: (current: NotificationSecrets) => NotificationSecrets,
  ) {
    const work = this.mutation.then(async () => {
      const next = update(await this.readSecrets());
      await this.vault.save("notification-secrets", next);
      this.secrets = next;
    });
    this.mutation = work.catch(() => {});
    await work;
  }
  async publicKey() {
    await this.updateSecrets((current) =>
      current.vapid
        ? current
        : { ...current, vapid: webpush.generateVAPIDKeys() },
    );
    return (await this.readSecrets()).vapid!.publicKey;
  }
  cancel(channel: "email" | "web", reason: string) {
    this.store.run(
      "UPDATE notification_deliveries SET status='cancelled',error=? WHERE channel=? AND status='pending'",
      reason,
      channel,
    );
  }
  async sendEmail(title: string, body: string, dedupe: string) {
    const c = mobileConfig(this.store).email;
    const password = (await this.readSecrets()).password;
    if (!password) throw new Error("missing-credentials");
    const transport = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.port === 465,
      requireTLS: c.port === 587,
      auth: { user: c.user, pass: password },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      const result = await transport.sendMail({
        from: { name: "CourseWatch", address: c.from },
        to: c.to,
        subject: title,
        text: body,
        messageId: `<${dedupe}@${c.from.split("@")[1]}>`,
      });
      if (!result.accepted?.length) throw new Error("not-accepted");
    } finally {
      transport.close();
    }
  }
  async sendWeb(target: string, title: string, body: string, dedupe: string) {
    const secrets = await this.readSecrets();
    const subscription = secrets.subscriptions?.[target];
    if (!subscription || !secrets.vapid)
      throw Object.assign(new Error("subscription-missing"), {
        statusCode: 410,
      });
    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: Array.from(title).slice(0, 160).join(""),
        body: Array.from(body).slice(0, 550).join(""),
        tag: dedupe,
      }),
      {
        vapidDetails: {
          subject: `mailto:${mobileConfig(this.store).web.contact}`,
          ...secrets.vapid,
        },
        TTL: 3600,
        urgency: "normal",
        timeout: 12000,
      },
    );
  }
  async test(channel: "email" | "web") {
    if (this.active || this.configuring)
      throw new Error("通知正在投递或保存，请稍后重试");
    this.active = true;
    try {
      const c = mobileConfig(this.store);
      if (!c[channel].enabled) throw new Error("请先保存并开启该通知渠道");
      const targets =
        channel === "email"
          ? ["email"]
          : pushDevices(this.store).map((d) => d.id);
      if (!targets.length) throw new Error("请先连接手机或 iPad");
      for (const target of targets) {
        const id = randomUUID();
        if (channel === "email")
          await this.sendEmail(
            "CourseWatch · 测试邮件",
            "这是模拟通知。邮件服务器接收后，收件与手机提示仍可能延迟。",
            id,
          );
        else
          await this.sendWeb(
            target,
            "CourseWatch · 测试通知",
            "这是模拟通知，请在手机或 iPad 通知中心核对。",
            id,
          );
      }
    } finally {
      this.active = false;
    }
  }
  async drain(engine: Engine) {
    if (this.active || this.configuring) return;
    this.active = true;
    try {
      const now = Date.now();
      // Expired and superseded reminders never accumulate for a channel that was offline.
      this.store.run(
        "UPDATE notification_deliveries SET status='cancelled',error='通知已超过 24 小时' WHERE status='pending' AND outbox_id IN (SELECT id FROM outbox WHERE at<?)",
        now - 86400000,
      );
      this.store.run(
        "UPDATE notification_deliveries SET status='cancelled',error='原通知已移除' WHERE status='pending' AND outbox_id NOT IN (SELECT id FROM outbox)",
      );
      const rows = this.store.all<{
        outbox_id: number;
        channel: "email" | "web";
        target: string;
        attempts: number;
        title: string;
        body: string;
        kind: string;
        task_id: string | null;
      }>(
        "SELECT d.*,o.title,o.body,o.kind,o.task_id FROM notification_deliveries d JOIN outbox o ON o.id=d.outbox_id WHERE d.status='pending' AND d.next_attempt<=? ORDER BY d.outbox_id LIMIT 10",
        now,
      );
      for (const row of rows) {
        // A previous network request can yield while the user completes a task,
        // changes reminder rules, or removes a device. Recheck each queued send.
        if (
          !this.store.all(
            "SELECT 1 FROM notification_deliveries WHERE outbox_id=? AND channel=? AND target=? AND status='pending'",
            row.outbox_id,
            row.channel,
            row.target,
          ).length
        )
          continue;
        const update = (status: string, error: string | null, next = 0) =>
          this.store.run(
            "UPDATE notification_deliveries SET status=?,error=?,attempts=attempts+1,next_attempt=?,accepted_at=? WHERE outbox_id=? AND channel=? AND target=?",
            status,
            error,
            next,
            status === "accepted" ? Date.now() : null,
            row.outbox_id,
            row.channel,
            row.target,
          );
        if (!mobileConfig(this.store)[row.channel].enabled) {
          update("cancelled", "通知渠道已关闭");
          continue;
        }
        if (row.task_id) {
          const task = engine.tasks().find((t) => t.id === row.task_id);
          if (task && !engine.courseEnabled(task)) {
            update("cancelled", "课程未选择");
            continue;
          }
        }
        try {
          const id = `cw-${row.outbox_id}-${row.target}`;
          if (row.channel === "email")
            await this.sendEmail(row.title, row.body, id);
          else await this.sendWeb(row.target, row.title, row.body, id);
          update("accepted", null);
        } catch (error) {
          const code = (error as { statusCode?: number }).statusCode;
          if (row.channel === "web" && (code === 404 || code === 410)) {
            this.store.set(
              "pushDevices",
              pushDevices(this.store).filter((d) => d.id !== row.target),
            );
            this.store.run(
              "UPDATE notification_deliveries SET status='failed',error='设备订阅已失效，请重新连接' WHERE channel='web' AND target=? AND status='pending'",
              row.target,
            );
            await this.updateSecrets((s) => {
              const subscriptions = { ...s.subscriptions };
              delete subscriptions[row.target];
              return { ...s, subscriptions };
            });
          } else
            update(
              row.attempts >= 2 ? "failed" : "pending",
              row.channel === "email"
                ? "邮件发送未确认，请检查 SMTP 设置；重试可能造成重复邮件"
                : "推送服务未确认接收，请检查网络及订阅",
              now + 60000 * 2 ** row.attempts,
            );
        }
      }
    } finally {
      this.active = false;
    }
  }
}
