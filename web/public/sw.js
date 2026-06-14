// Loci Focus service worker — handles notification clicks
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const notificationType = data.type;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          if (notificationType) client.postMessage({ type: "loci-notification-click", notificationType, slot: data.slot });
          return client.focus();
        }
      }
      if (notificationType === "coach-checkin") return clients.openWindow("/?tab=coach");
      if (notificationType === "daily-checkin") return clients.openWindow(`/?tab=today&checkin=${data.slot}`);
      return clients.openWindow("/");
    })
  );
});

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title || "Loci Focus", {
      body: data.body || "Time to focus.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "loci-push",
      renotify: true,
      data: { url: "/" }
    })
  );
});
