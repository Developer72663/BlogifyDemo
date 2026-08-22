const webpush = require("web-push");
const PushSubscription = require("../models/PushSubscription");
const User = require("../models/user");

let configured = false;
let configurationError = null;

function normalizeVapidSubject(value) {
    const subject = String(value || "").trim();
    if (!subject) return "";
    // web-push requires a mailto: URI or an https URL. Accept a plain
    // email in the environment too, so VAPID_SUBJECT=vshntvelip@gmail.com
    // works safely in existing Blogify deployments.
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject)) return `mailto:${subject}`;
    return subject;
}

function configureWebPush() {
    if (configured) return true;

    const publicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();
    const privateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim();
    const subject = normalizeVapidSubject(process.env.VAPID_SUBJECT);

    if (!publicKey || !privateKey || !subject) {
        configurationError = "Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT.";
        console.warn(`Web Push is not configured. ${configurationError}`);
        return false;
    }

    try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        configured = true;
        configurationError = null;
        return true;
    } catch (error) {
        configurationError = error.message;
        console.error("Web Push VAPID configuration error:", error.message);
        return false;
    }
}

function getPublicKey() {
    const key = String(process.env.VAPID_PUBLIC_KEY || "").trim();
    return key || null;
}

function getConfigurationError() {
    return configurationError;
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

    const saved = await PushSubscription.findOneAndUpdate(
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

    await User.updateOne(
        { _id: userId },
        { $set: { "notificationSettings.pushEnabled": true } }
    );

    return saved;
}

async function removeSubscription(userId, endpoint) {
    if (!endpoint) return { deletedCount: 0 };
    const result = await PushSubscription.deleteOne({ user: userId, endpoint: String(endpoint) });
    const remaining = await PushSubscription.countDocuments({ user: userId });
    if (remaining === 0) {
        await User.updateOne({ _id: userId }, { $set: { "notificationSettings.pushEnabled": false } });
    }
    return result;
}

async function removeAllSubscriptions(userId) {
    const result = await PushSubscription.deleteMany({ user: userId });
    await User.updateOne({ _id: userId }, { $set: { "notificationSettings.pushEnabled": false } });
    return result;
}

async function sendToSubscription(subscriptionDoc, payload, options = {}) {
    if (!configureWebPush()) return { sent: false, skipped: true, error: configurationError };

    const subscription = {
        endpoint: subscriptionDoc.endpoint,
        keys: subscriptionDoc.keys
    };

    try {
        await webpush.sendNotification(subscription, JSON.stringify(payload), {
            TTL: Number.isFinite(Number(options.ttl)) ? Number(options.ttl) : 60 * 60 * 24,
            urgency: options.urgency || "normal"
        });
        await PushSubscription.updateOne(
            { _id: subscriptionDoc._id },
            { $set: { lastUsedAt: new Date() } }
        );
        return { sent: true };
    } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
            await PushSubscription.deleteOne({ _id: subscriptionDoc._id });
            return { sent: false, removed: true };
        }

        console.error("Web Push send error:", error.statusCode || "", error.message);
        return { sent: false, error: error.message, statusCode: error.statusCode || null };
    }
}

async function sendToUser(userId, payload, options = {}) {
    if (!configureWebPush()) return { sent: 0, failed: 1, skipped: true, error: configurationError };

    const subscriptions = await PushSubscription.find({ user: userId }).lean();
    if (!subscriptions.length) return { sent: 0, failed: 0, removed: 0 };

    const results = await Promise.all(
        subscriptions.map(subscription => sendToSubscription(subscription, payload, options))
    );

    return {
        sent: results.filter(result => result.sent).length,
        removed: results.filter(result => result.removed).length,
        failed: results.filter(result => result.error && !result.skipped).length,
        skipped: results.some(result => result.skipped) || undefined
    };
}

async function sendTestNotification(userId) {
    return sendToUser(userId, {
        title: "Blogify",
        body: "Web push notifications are working!",
        icon: "/imgs/default.png",
        badge: "/imgs/default.png",
        tag: "blogify-test",
        renotify: true,
        data: { url: "/notifications", type: "test" }
    }, { urgency: "high", ttl: 300 });
}

module.exports = {
    configureWebPush,
    getPublicKey,
    getConfigurationError,
    saveSubscription,
    removeSubscription,
    removeAllSubscriptions,
    sendToSubscription,
    sendToUser,
    sendTestNotification
};
