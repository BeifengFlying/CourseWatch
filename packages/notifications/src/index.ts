import type { Engine } from "../../core/src/index.js";
export async function sendNative(title: string, message: string) {
  const { default: notifier } = await import("node-notifier");
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("系统通知接口未确认接收"));
      }
    }, 10000);
    notifier.notify(
      { title, message, appID: "CourseWatch", timeout: 5, wait: false },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve();
      },
    );
  });
}
export async function drain(engine: Engine) {
  const db = engine.store;
  const now = Date.now();
  const rows = db.all<{
    id: number;
    title: string;
    body: string;
    attempts: number;
  }>(
    "SELECT * FROM outbox WHERE delivered_at IS NULL AND next_attempt<=? ORDER BY id LIMIT 5",
    now,
  );
  if (!engine.settings().nativeNotifications) {
    db.run(
      "UPDATE outbox SET delivered_at=?,error='系统通知关闭，记录保留在通知中心' WHERE delivered_at IS NULL",
      now,
    );
    return;
  }
  for (const row of rows) {
    try {
      await sendNative(row.title, row.body);
      db.run(
        "UPDATE outbox SET delivered_at=?,error=NULL WHERE id=?",
        Date.now(),
        row.id,
      );
    } catch {
      const attempts = row.attempts + 1;
      db.run(
        "UPDATE outbox SET attempts=?,next_attempt=?,delivered_at=?,error=? WHERE id=?",
        attempts,
        now + Math.min(3600000, 60000 * 2 ** attempts),
        attempts >= 3 ? now : null,
        "系统通知未确认接收，请检查权限；通知中心记录已保留",
        row.id,
      );
    }
  }
}
