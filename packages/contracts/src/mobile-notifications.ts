import { z } from "zod";

const address = z.string().trim().email().max(254);
export const MobileNotificationConfig = z
  .object({
    email: z
      .object({
        enabled: z.boolean().default(false),
        host: z.string().trim().max(253).default(""),
        port: z.union([z.literal(465), z.literal(587)]).default(465),
        user: z.string().trim().max(254).default(""),
        from: z.union([address, z.literal("")]).default(""),
        to: z.union([address, z.literal("")]).default(""),
      })
      .default({
        enabled: false,
        host: "",
        port: 465,
        user: "",
        from: "",
        to: "",
      }),
    web: z
      .object({
        enabled: z.boolean().default(false),
        pageUrl: z
          .union([z.url({ protocol: /^https$/ }), z.literal("")])
          .default(""),
        contact: z.union([address, z.literal("")]).default(""),
      })
      .default({ enabled: false, pageUrl: "", contact: "" }),
    calendar: z
      .object({ enabled: z.boolean().default(false) })
      .default({ enabled: false }),
  })
  .superRefine((v, ctx) => {
    if (
      v.email.enabled &&
      (!v.email.host || !v.email.user || !v.email.from || !v.email.to)
    )
      ctx.addIssue({
        code: "custom",
        message: "请填写发件服务器、账号和两个邮箱地址",
      });
    if (
      v.email.from &&
      v.email.to &&
      v.email.from.toLowerCase() === v.email.to.toLowerCase()
    )
      ctx.addIssue({ code: "custom", message: "发件邮箱和收件邮箱必须不同" });
    if (
      v.email.host &&
      !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(
        v.email.host,
      )
    )
      ctx.addIssue({ code: "custom", message: "SMTP 服务器请填写域名" });
    if (v.web.enabled && (!v.web.pageUrl || !v.web.contact))
      ctx.addIssue({
        code: "custom",
        message: "请填写 HTTPS 订阅页地址和推送联系邮箱",
      });
    if (v.web.pageUrl) {
      const u = new URL(v.web.pageUrl);
      if (u.username || u.password || u.hash || u.search)
        ctx.addIssue({
          code: "custom",
          message: "订阅页地址不能包含账号、查询参数或片段",
        });
    }
  });
export type MobileNotificationConfig = z.infer<typeof MobileNotificationConfig>;
export const defaultMobileNotifications = MobileNotificationConfig.parse({});
export interface PushDevice {
  id: string;
  name: string;
  createdAt: number;
}

// Only supported browser push services may be called with imported endpoints.
// This prevents a subscription file from turning the local service into an HTTP proxy.
export function safePushEndpoint(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.hash &&
      (u.hostname === "fcm.googleapis.com" ||
        u.hostname === "android.googleapis.com" ||
        u.hostname === "web.push.apple.com" ||
        u.hostname === "updates.push.services.mozilla.com" ||
        /^[a-z0-9-]+\.push\.apple\.com$/.test(u.hostname))
    );
  } catch {
    return false;
  }
}
export const BrowserSubscription = z.object({
  endpoint: z
    .string()
    .max(4096)
    .refine(safePushEndpoint, "不支持的推送服务地址"),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}={0,2}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}={0,2}$/),
  }),
});
