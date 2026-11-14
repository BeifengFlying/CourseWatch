// Local fixtures only. No email, browser push service, iCloud account or live course is contacted.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createECDH } from "node:crypto";
import { chromium } from "playwright";
import { createServer } from "../apps/local-service/src/server.ts";
const dir = mkdtempSync(join(tmpdir(), "cw-notification-ui-")),
  port = 17346;
const token = "notification-preview-".repeat(5),
  memory = {};
process.env.COURSEWATCH_NATIVE_TOKEN = token;
const server = await createServer({
  dir,
  port,
  test: true,
  notificationSecrets: {
    read: async (id) => structuredClone(memory[id]),
    save: async (id, value) => {
      memory[id] = structuredClone(value);
    },
  },
});
await server.app.listen({ host: "127.0.0.1", port });
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const context = await browser.newContext({
  viewport: { width: 1060, height: 780 },
});
await context.addInitScript((token) => {
  localStorage.setItem("coursewatch-client-token", token);
  window.__notificationActions = [];
  window.webkit = {
    messageHandlers: {
      coursewatch: {
        postMessage: (m) => window.__notificationActions.push(m.action),
      },
    },
  };
}, token);
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
mkdirSync("docs/screenshots", { recursive: true });
const overflow = async (target) =>
  assert.ok(
    await target.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    "component overflow",
  );
try {
  await page.goto(`${origin}/?desktop=1`);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const channels = page.getByRole("region", { name: "手机通知设置" });
  await channels.getByLabel("开启邮件通知", { exact: true }).waitFor();
  await channels.getByLabel("开启邮件通知", { exact: true }).check();
  await channels.getByLabel("发件邮箱服务", { exact: true }).selectOption("qq");
  await channels
    .getByLabel("发件邮箱", { exact: true })
    .fill("sender@example.com");
  await channels
    .getByLabel("收件邮箱", { exact: true })
    .fill("sender@example.com");
  await channels
    .getByLabel("SMTP 登录账号", { exact: true })
    .fill("sender@example.com");
  await channels
    .getByLabel("SMTP 授权码或应用专用密码", { exact: true })
    .fill("local-fixture-only");
  await channels
    .getByRole("button", { name: "保存手机通知设置", exact: true })
    .click();
  await channels
    .getByRole("alert")
    .getByText("发件邮箱和收件邮箱必须不同")
    .waitFor();
  assert.equal(
    await channels
      .getByLabel("SMTP 授权码或应用专用密码", { exact: true })
      .inputValue(),
    "local-fixture-only",
  );
  await channels
    .getByLabel("收件邮箱", { exact: true })
    .fill("receiver@example.net");
  await channels.getByLabel("开启网页推送", { exact: true }).check();
  await channels
    .getByLabel("HTTPS 订阅页地址", { exact: true })
    .fill("https://notify.example.org/mobile-push/");
  await channels
    .getByLabel("推送联系邮箱", { exact: true })
    .fill("sender@example.com");
  await channels
    .getByRole("button", { name: "保存手机通知设置", exact: true })
    .click();
  await channels
    .getByRole("status")
    .getByText("手机通知设置已保存", { exact: true })
    .waitFor();
  assert.equal(
    await channels
      .getByLabel("SMTP 授权码或应用专用密码", { exact: true })
      .inputValue(),
    "",
  );
  await channels
    .getByRole("button", { name: "生成手机配对码", exact: true })
    .click();
  await channels.getByAltText("手机通知配对二维码").waitFor();
  const link = await channels
    .getByLabel("手机订阅链接", { exact: true })
    .inputValue();
  const setup = JSON.parse(
    Buffer.from(
      new URLSearchParams(new URL(link).hash.slice(1)).get("config"),
      "base64url",
    ).toString(),
  );
  // Exercise the static mobile page's export path with mocked OS push APIs.
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const curve = createECDH("prime256v1");
  curve.generateKeys();
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/local-ui-fixture",
    keys: {
      p256dh: curve.getPublicKey().toString("base64url"),
      auth: Buffer.alloc(16, 5).toString("base64url"),
    },
  };
  await phoneContext.addInitScript(
    ({ subscription }) => {
      const sub = {
        toJSON: () => subscription,
        options: { applicationServerKey: null },
      };
      const registration = {
        pushManager: {
          getSubscription: async () => null,
          subscribe: async () => sub,
        },
      };
      Object.defineProperty(navigator, "serviceWorker", {
        value: {
          register: async () => registration,
          ready: Promise.resolve(registration),
        },
      });
      Object.defineProperty(Notification, "requestPermission", {
        value: async () => "granted",
      });
    },
    { subscription },
  );
  const phone = await phoneContext.newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(`${origin}/mobile-push/${new URL(link).hash}`);
  await phone.getByLabel("设备名称", { exact: true }).fill("模拟 Android");
  await phone
    .getByRole("button", { name: "允许通知并生成订阅信息", exact: true })
    .click();
  await phone
    .getByText(
      "已生成订阅信息。传回电脑并导入后，点击“测试网页推送”核对接收。",
      { exact: true },
    )
    .waitFor();
  const exported = await phone
    .getByLabel("订阅信息", { exact: true })
    .inputValue();
  assert.equal(JSON.parse(exported).nonce, setup.nonce);
  await channels
    .getByLabel("手机生成的订阅信息", { exact: true })
    .fill(exported);
  await channels
    .getByRole("button", { name: "导入订阅信息", exact: true })
    .click();
  await channels.getByText("模拟 Android", { exact: true }).waitFor();
  for (const width of [1060, 820, 390, 320])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 780 });
      await page.emulateMedia({ colorScheme: theme });
      await channels
        .getByLabel("发件邮箱", { exact: true })
        .scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await overflow(channels);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      for (const control of await channels
        .locator("input:not([type=checkbox]),select,textarea,button")
        .all()) {
        if (await control.isVisible()) {
          const rect = await control.boundingBox();
          assert.ok(rect.height >= 43, "control height");
        }
      }
      await page.screenshot({
        path: `docs/screenshots/mobile-notifications-${width}-${theme}.png`,
      });
    }
  for (const width of [768, 390, 320]) {
    await phone.setViewportSize({ width, height: 900 });
    await phone.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.ok(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await phone.screenshot({
      path: `docs/screenshots/mobile-subscription-${width}.png`,
      fullPage: true,
    });
  }
  const ipadContext = await browser.newContext({
    viewport: { width: 768, height: 1024 },
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const ipad = await ipadContext.newPage();
  await ipad.goto(`${origin}/mobile-push/${new URL(link).hash}`);
  await ipad
    .getByRole("button", { name: "允许通知并生成订阅信息", exact: true })
    .click();
  await ipad
    .getByRole("status")
    .getByText("请先通过 Safari 添加到主屏幕，再从桌面图标打开。", {
      exact: true,
    })
    .waitFor();
  // The browser settings view reuses the same component.
  const web = await context.newPage();
  await web.goto(origin);
  await web.getByRole("button", { name: "设置", exact: true }).click();
  await web.getByRole("region", { name: "手机通知设置" }).waitFor();
  await web.setViewportSize({ width: 320, height: 780 });
  await overflow(web.getByRole("region", { name: "手机通知设置" }));
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      widths: [1060, 820, 390, 320],
      themes: ["light", "dark"],
      mobileWidths: [768, 390, 320],
      dualMailboxValidation: true,
      secretNotEchoed: true,
      subscriptionExportImport: true,
      iPadHomeScreenGuard: true,
      errors,
    }),
  );
} finally {
  await browser.close();
  await server.app.close();
  rmSync(dir, { recursive: true, force: true });
}
