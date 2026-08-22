const BLOGIFY_SW_VERSION = "blogify-push-v3";

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

    const nested = data.data && typeof data.data === "object" ? data.data : {};
    const type = data.type || nested.type || "notification";
    const messageId = data.messageId || nested.messageId || null;
    const title = data.title || "Blogify";
    const options = {
        body: data.body || "You have a new notification.",
        icon: data.icon || "/imgs/default.png",
        badge: data.badge || "/imgs/default.png",
        tag: data.tag || (type === "message" && messageId ? `blogify-message-${messageId}` : "blogify-notification"),
        renotify: type === "message" ? false : Boolean(data.renotify),
        data: {
            url: data.url || nested.url || "/notifications",
            type,
            conversationId: data.conversationId || nested.conversationId || null,
            senderId: data.senderId || nested.senderId || null,
            messageId,
            notificationId: data.notificationId || nested.notificationId || null,
            serviceWorkerVersion: BLOGIFY_SW_VERSION
        }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
    event.notification.close();
    const targetUrl = event.notification?.data?.url || "/notifications";
    let absoluteUrl;
    try {
        absoluteUrl = new URL(targetUrl, self.location.origin).href;
    } catch (_) {
        absoluteUrl = new URL("/notifications", self.location.origin).href;
    }

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
