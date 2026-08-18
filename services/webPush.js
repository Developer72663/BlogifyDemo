const webpush = require("web-push");
const PushSubscription = require("../models/PushSubscription");

let configured = false;

function configureWebPush() {
    if (configured) return true;

    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;

    if (!publicKey || !privateKey || !subject) {
        console.warn("Web Push is not configured. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT.");
        return false;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
    return true;
}

function getPublicKey() {
    return process.env.VAPID_PUBLIC_KEY || null;
}

function normalizeSubscription(subscription) {
    if (!subscription || typeof subscription !== "object") return null;
    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) return null;

    return {
        endpoint: String(subscription.endpoint),
        keys: {
            p256dh: String(subscription.keys.p256dh),
            auth: String(subscription.keys.auth)
        }
    };
}

async function saveSubscription(userId, subscription, metadata = {}) {
    const normalized = normalizeSubscription(subscription);
    if (!normalized) throw new Error("Invalid push subscription");

    return PushSubscription.findOneAndUpdate(
        { endpoint: normalized.endpoint },
        {
            $set: {
                user: userId,
                keys: normalized.keys,
                userAgent: metadata.userAgent || "",
                deviceName: metadata.deviceName || "",
                lastUsedAt: new Date()
            }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
}

async function removeSubscription(userId, endpoint) {
    if (!endpoint) return { deletedCount: 0 };
    return PushSubscription.deleteOne({ user: userId, endpoint: String(endpoint) });
}

async function removeAllSubscriptions(userId) {
    return PushSubscription.deleteMany({ user: userId });
}

async function sendToSubscription(subscriptionDoc, payload, options = {}) {
    if (!configureWebPush()) return { sent: false, skipped: true };

    const subscription = {
        endpoint: subscriptionDoc.endpoint,
        keys: subscriptionDoc.keys
    };

    try {
        await webpush.sendNotification(subscription, JSON.stringify(payload), {
            TTL: options.ttl || 60 * 60 * 24,
            urgency: options.urgency || "normal"
        });
        await PushSubscription.updateOne(
            { _id: subscriptionDoc._id },
            { $set: { lastUsedAt: new Date() } }
        );
        return { sent: true };
    } catch (error) {
        // Browsers return 404/410 when a subscription is no longer valid.
        if (error.statusCode === 404 || error.statusCode === 410) {
            await PushSubscription.deleteOne({ _id: subscriptionDoc._id });
            return { sent: false, removed: true };
        }

        console.error("Web Push send error:", error.message);
        return { sent: false, error: error.message };
    }
}

async function sendToUser(userId, payload, options = {}) {
    if (!configureWebPush()) return { sent: 0, skipped: true };

    const subscriptions = await PushSubscription.find({ user: userId }).lean();
    if (!subscriptions.length) return { sent: 0 };

    const results = await Promise.all(
        subscriptions.map(subscription => sendToSubscription(subscription, payload, options))
    );

    return {
        sent: results.filter(result => result.sent).length,
        removed: results.filter(result => result.removed).length,
        failed: results.filter(result => result.error).length
    };
}

async function sendTestNotification(userId) {
    return sendToUser(userId, {
        title: "Blogify",
        body: "Web push notifications are working!",
        icon: "/imgs/default.png",
        badge: "/imgs/default.png",
        url: "/notifications"
    }, { urgency: "high", ttl: 300 });
}

module.exports = {
    configureWebPush,
    getPublicKey,
    saveSubscription,
    removeSubscription,
    removeAllSubscriptions,
    sendToSubscription,
    sendToUser,
    sendTestNotification
};
