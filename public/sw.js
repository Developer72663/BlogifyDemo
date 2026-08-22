const BLOGIFY_SW_VERSION = "blogify-push-v2";

self.addEventListener("install", event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("push", event => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (_) {
        data = { title: "Blogify", body: event.data ? event.data.text() : "You have a new notification." };
    }

    const title = data.title || "Blogify";
    const options = {
        body: data.body || "You have a new notification.",
        icon: data.icon || "/imgs/default.png",
        badge: data.badge || "/imgs/default.png",
        tag: data.tag || "blogify-notification",
        renotify: Boolean(data.renotify),
        data: {
            url: data.url || data.data?.url || "/notifications",
            type: data.type || data.data?.type || "notification",
            notificationId: data.notificationId || data.data?.notificationId || null,
            serviceWorkerVersion: BLOGIFY_SW_VERSION
        }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
    event.notification.close();
    const targetUrl = event.notification?.data?.url || "/notifications";
    const absoluteUrl = new URL(targetUrl, self.location.origin).href;

    event.waitUntil((async () => {
        const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
        const sameOrigin = windows.find(client => {
            try { return new URL(client.url).origin === self.location.origin; } catch (_) { return false; }
        });

        if (sameOrigin) {
            await sameOrigin.focus();
            if ("navigate" in sameOrigin) await sameOrigin.navigate(absoluteUrl);
            return;
        }
        await clients.openWindow(absoluteUrl);
    })());
});

self.addEventListener("notificationclose", () => {});
