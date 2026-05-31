// Loci Focus service worker — handles notification clicks
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
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
