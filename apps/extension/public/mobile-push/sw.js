self.addEventListener("push", (event) => {
  let notice = {};
  try {
    notice = event.data?.json() || {};
  } catch {}
  event.waitUntil(
    self.registration.showNotification(String(notice.title || "CourseWatch"), {
      body: String(notice.body || "收到一条提醒，请在电脑端查看。"),
      tag: String(notice.tag || "coursewatch"),
      icon: "./icon.png",
      data: { url: new URL("./index.html", self.registration.scope).href },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const pages = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const page of pages)
        if (new URL(page.url).origin === self.location.origin)
          return page.focus();
      return self.clients.openWindow(
        new URL("./index.html", self.registration.scope).href,
      );
    })(),
  );
});
