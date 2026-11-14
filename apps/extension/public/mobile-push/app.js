const el = (id) => document.getElementById(id);
const status = (message) => {
  el("status").textContent = message;
};
const apple =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () =>
  matchMedia("(display-mode: standalone)").matches ||
  navigator.standalone === true;
let downloaded;
try {
  const incoming = new URLSearchParams(location.hash.slice(1)).get("config");
  if (incoming) localStorage.setItem("coursewatch-push-setup", incoming);
  el("pair-code").value =
    incoming || localStorage.getItem("coursewatch-push-setup") || "";
} catch {
  status("浏览器未允许保存配对码，请手动粘贴。");
}
if (!apple) el("apple-guide").hidden = true;
if (!window.isSecureContext)
  status("请通过 HTTPS 打开本页，普通局域网 HTTP 地址不支持通知。");
if (apple && !standalone())
  status("请先添加到主屏幕，再从桌面图标打开。若配对码没有保留，请重新粘贴。");
el("copy-setup").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(el("pair-code").value.trim());
    status("配对码已复制。从主屏幕打开后可粘贴使用。");
  } catch {
    el("pair-code").select();
    status("请长按配对码并复制。");
  }
});
el("subscription-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (
    !isSecureContext ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    status(
      "当前浏览器不支持网页推送。请使用支持通知的浏览器；iPhone／iPad 请从主屏幕打开。",
    );
    return;
  }
  if (apple && !standalone()) {
    status("请先通过 Safari 添加到主屏幕，再从桌面图标打开。");
    return;
  }
  let setup;
  try {
    const code = el("pair-code").value.trim();
    setup = JSON.parse(atob(code.replace(/-/g, "+").replace(/_/g, "/")));
    if (
      !setup.nonce ||
      !/^[A-Za-z0-9_-]{87}$/.test(setup.publicKey) ||
      setup.expiresAt < Date.now()
    )
      throw new Error();
    localStorage.setItem("coursewatch-push-setup", code);
  } catch {
    status("配对码无效或已过期，请在电脑上重新生成。");
    return;
  }
  // Request permission directly from the user's tap, before service worker registration waits.
  const permissionRequest = Notification.requestPermission();
  el("subscribe").disabled = true;
  try {
    if ((await permissionRequest) !== "granted")
      throw new Error("未获得通知权限，请在系统设置中允许通知。");
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    const registration = await navigator.serviceWorker.ready;
    const key = Uint8Array.from(
      atob(setup.publicKey.replace(/-/g, "+").replace(/_/g, "/") + "="),
      (c) => c.charCodeAt(0),
    );
    let subscription = await registration.pushManager.getSubscription();
    if (
      subscription &&
      Array.from(
        new Uint8Array(subscription.options.applicationServerKey || []),
      ).join(",") !== Array.from(key).join(",")
    ) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ||= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
    downloaded = JSON.stringify(
      {
        version: 1,
        nonce: setup.nonce,
        publicKey: setup.publicKey,
        name: el("device-name").value.trim(),
        subscription: subscription.toJSON(),
      },
      null,
      2,
    );
    el("subscription").value = downloaded;
    el("result").hidden = false;
    status("已生成订阅信息。传回电脑并导入后，点击“测试网页推送”核对接收。");
  } catch (error) {
    status(
      error.message || "无法连接推送服务，请检查网络与系统通知权限后重试。",
    );
  } finally {
    el("subscribe").disabled = false;
  }
});
el("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(downloaded);
    status("订阅信息已复制，请粘贴到电脑端。");
  } catch {
    el("subscription").select();
    status("请长按订阅信息并复制，或保存订阅文件。");
  }
});
el("download").addEventListener("click", () => {
  const url = URL.createObjectURL(
    new Blob([downloaded], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "coursewatch-subscription.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
