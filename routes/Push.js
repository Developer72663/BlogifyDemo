const express = require("express");
const router = express.Router();
const { getPublicKey, saveSubscription, removeSubscription, removeAllSubscriptions, sendTestNotification } = require("../services/webPush");
const PushSubscription = require("../models/PushSubscription");

function requireUser(req, res, next) {
    if (!req.user) return res.status(401).json({ success: false, error: "Authentication required" });
    next();
}

router.get("/public-key", requireUser, (req, res) => {
    const publicKey = getPublicKey();
    if (!publicKey) return res.status(503).json({ success: false, error: "Web Push is not configured" });
    res.json({ success: true, publicKey });
});

router.post("/subscribe", requireUser, async (req, res) => {
    try {
        const { subscription, deviceName } = req.body || {};
        if (!subscription) return res.status(400).json({ success: false, error: "Subscription is required" });

        const saved = await saveSubscription(req.user._id, subscription, {
            deviceName,
            userAgent: req.get("user-agent") || ""
        });

        res.status(201).json({ success: true, subscriptionId: saved._id });
    } catch (error) {
        console.error("Push subscribe error:", error.message);
        res.status(400).json({ success: false, error: error.message });
    }
});

router.delete("/subscribe", requireUser, async (req, res) => {
    try {
        const endpoint = req.body?.endpoint || req.query?.endpoint;
        if (!endpoint) return res.status(400).json({ success: false, error: "Endpoint is required" });
        await removeSubscription(req.user._id, endpoint);
        res.json({ success: true });
    } catch (error) {
        console.error("Push unsubscribe error:", error.message);
        res.status(500).json({ success: false, error: "Unable to unsubscribe" });
    }
});

router.delete("/subscriptions", requireUser, async (req, res) => {
    try {
        await removeAllSubscriptions(req.user._id);
        res.json({ success: true });
    } catch (error) {
        console.error("Remove push subscriptions error:", error.message);
        res.status(500).json({ success: false, error: "Unable to remove subscriptions" });
    }
});

router.get("/subscriptions", requireUser, async (req, res) => {
    try {
        const subscriptions = await PushSubscription.find({ user: req.user._id })
            .select("_id endpoint deviceName userAgent createdAt lastUsedAt")
            .sort({ lastUsedAt: -1 })
            .lean();
        res.json({ success: true, subscriptions });
    } catch (error) {
        console.error("Get push subscriptions error:", error.message);
        res.status(500).json({ success: false, error: "Unable to load subscriptions" });
    }
});

router.post("/test", requireUser, async (req, res) => {
    try {
        const result = await sendTestNotification(req.user._id);
        if (result.skipped) return res.status(503).json({ success: false, error: "Web Push is not configured" });
        if (!result.sent) return res.status(404).json({ success: false, error: "No active push subscription found" });
        res.json({ success: true, result });
    } catch (error) {
        console.error("Push test error:", error.message);
        res.status(500).json({ success: false, error: "Unable to send test notification" });
    }
});

module.exports = router;
