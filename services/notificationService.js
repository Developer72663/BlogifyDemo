const Notification = require("../models/Notification");
const User = require("../models/user");
const Blog = require("../models/Blog");
const { sendEmail, sendCommentNotificationEmail, sendFollowNotificationEmail } = require("./email");
const { sendToUser } = require("./webPush");

const pushSettingForType = { message: "pushOnMessage", comment: "pushOnComment", reply: "pushOnReply", like: "pushOnLike", follow: "pushOnFollow", follow_request: "pushOnFollowRequest", mention: "pushOnMention", blog_post: "pushOnBlogPost" };
const emailSettingForType = { comment: "emailOnComment", reply: "emailOnComment", follow: "emailOnNewFollower", follow_request: "emailOnFollowRequest", like: "emailOnLike", mention: "emailOnMention" };

function getAppUrl() {
    const configured = String(process.env.APP_URL || "").trim().replace(/\/$/, "");
    if (configured) return configured;
    const vercelUrl = String(process.env.VERCEL_URL || "").trim();
    if (vercelUrl) return `https://${vercelUrl}`;
    return "http://localhost:8000";
}

function getNotificationUrl(type, data = {}) {
    if (data.url) return data.url;
    if (type === "message" && data.conversationId) return `/messages?conversation=${data.conversationId}`;
    if (["comment", "reply", "like", "blog_post"].includes(type) && data.blog) return `/blogs/${data.blog}`;
    if (["follow", "follow_request", "mention"].includes(type)) return data.actor ? `/profile/${data.actor}` : "/notifications";
    return "/notifications";
}

function absoluteUrl(pathOrUrl) {
    if (!pathOrUrl) return getAppUrl();
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return `${getAppUrl()}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function normalizePushImage(imageUrl) {
    const value = String(imageUrl || "").trim();
    if (!value) return absoluteUrl("/imgs/default.png");
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("//")) return `https:${value}`;
    return absoluteUrl(value);
}

async function getPushActorImage(actorId) {
    if (!actorId) return normalizePushImage("/imgs/default.png");
    try {
        const actor = await User.findById(actorId).select("profileImageURL").lean();
        return normalizePushImage(actor?.profileImageURL);
    } catch (_) {
        return normalizePushImage("/imgs/default.png");
    }
}

async function sendPushForNotification(recipientId, type, data = {}) {
    try {
        const setting = pushSettingForType[type];
        if (!setting) return { sent: 0, skipped: true };
        const user = await User.findById(recipientId).select(`notificationSettings.${setting} notificationSettings.pushEnabled`).lean();
        if (!user?.notificationSettings?.pushEnabled || user.notificationSettings[setting] === false) return { sent: 0, skipped: true };

        // Web Push icons must be reachable by the browser. Use the actor's actual
        // profile image and convert relative/Cloudinary URLs to an absolute URL.
        // Fall back to the Blogify default avatar when no profile image exists.
        const actorImage = await getPushActorImage(data.actor);
        const icon = normalizePushImage(data.pushIcon || actorImage);

        return await sendToUser(recipientId, {
            title: data.pushTitle || data.title || "Blogify",
            body: data.pushMessage || data.message || "You have a new notification",
            icon,
            badge: normalizePushImage(data.pushBadge || "/imgs/default.png"),
            image: data.pushImage ? normalizePushImage(data.pushImage) : undefined,
            tag: `blogify-${type}-${data.blog || data.messageRef || data.actor || Date.now()}`,
            renotify: true,
            data: { url: getNotificationUrl(type, data), type }
        }, { urgency: type === "message" ? "high" : "normal", ttl: 300 });
    } catch (error) {
        console.error("Web Push notification error:", error.message);
        return { sent: 0, failed: 1, error: error.message };
    }
}

async function sendEmailForNotification(recipientId, type, data = {}) {
    try {
        const setting = emailSettingForType[type];
        if (!setting) return;
        const user = await User.findById(recipientId).select("fullName email profileImageURL notificationSettings").lean();
        if (!user?.email || user.notificationSettings?.[setting] === false) return;
        let actor = null;
        if (data.actor) actor = await User.findById(data.actor).select("fullName profileImageURL").lean();
        let blog = null;
        if (data.blog) blog = await Blog.findById(data.blog).select("title slug").lean();
        const actorName = actor?.fullName || data.actorName || "Someone";
        const blogTitle = blog?.title || data.blogTitle || "your blog";
        const blogPath = blog?.slug ? `/blogs/${blog.slug}` : getNotificationUrl(type, data);
        const blogLink = absoluteUrl(blogPath);
        const profileLink = absoluteUrl(`/profile/${data.actor || ""}`);
        switch (type) {
            case "comment":
            case "reply":
                await sendCommentNotificationEmail(user.email, { blogTitle, actorName, comment: String(data.comment || data.message || "You have a new comment.").substring(0, 500), blogLink });
                break;
            case "follow":
                await sendFollowNotificationEmail(user.email, { followerName: actorName, followerImage: actor?.profileImageURL || "/imgs/default.png", profileLink });
                break;
            case "like":
                await sendEmail(user.email, `${actorName} liked your blog "${blogTitle}"`, `<p><strong>${actorName}</strong> liked your blog <strong>"${blogTitle}"</strong>.</p><p><a href="${blogLink}">View your blog</a></p>`);
                break;
            case "follow_request":
                await sendEmail(user.email, `${actorName} requested to follow you`, `<p><strong>${actorName}</strong> requested to follow you on Blogify.</p><p><a href="${absoluteUrl("/notifications")}">Review the follow request</a></p>`);
                break;
            case "mention":
                await sendEmail(user.email, `${actorName} mentioned you on Blogify`, `<p><strong>${actorName}</strong> mentioned you on Blogify.</p><p><a href="${absoluteUrl(getNotificationUrl(type, data))}">View notification</a></p>`);
                break;
            default:
                break;
        }
    } catch (error) {
        console.error(`Email notification error (${type}):`, error.message);
    }
}

class NotificationService {
    static async createNotification(recipientId, type, data = {}) {
        const notification = await Notification.create({ recipient: recipientId, type, title: data.title, message: data.message, blog: data.blog || null, actor: data.actor || null, request: data.request || null, messageRef: data.messageRef || null, conversationId: data.conversationId || null });
        const deliveryTasks = [sendEmailForNotification(recipientId, type, data)];
        if (!data.skipPush) deliveryTasks.push(sendPushForNotification(recipientId, type, data));
        await Promise.allSettled(deliveryTasks);
        return notification;
    }

    static async createBlogPostNotifications(authorId, blogId, blogTitle) {
        try {
            const author = await User.findById(authorId).select("fullName followers profileImageURL").lean();
            if (!author?.followers?.length) return;
            const data = { title: "New blog post", message: `${author.fullName} published a new blog: "${blogTitle}"`, blog: blogId, actor: authorId, pushIcon: author.profileImageURL };
            await Notification.insertMany(author.followers.map(recipientId => ({ recipient: recipientId, type: "blog_post", title: data.title, message: data.message, blog: blogId, actor: authorId })));
            await Promise.allSettled(author.followers.map(recipientId => sendPushForNotification(recipientId, "blog_post", data)));
        } catch (error) {
            console.error("Error creating blog post notifications:", error.message);
        }
    }

    static async sendEmailNotification(user, type, data = {}) { if (!user?._id) return; return sendEmailForNotification(user._id, type, data); }

    static async getUserNotifications(userId, limit = 20, page = 1) {
        try {
            limit = Math.min(Math.max(parseInt(limit) || 20, 1), 50);
            page = Math.max(parseInt(page) || 1, 1);
            const skip = (page - 1) * limit;
            // Chat messages are intentionally excluded from the notification center.
            const notificationFilter = { recipient: userId, type: { $ne: "message" } };
            const [notifications, total] = await Promise.all([
                Notification.find(notificationFilter).sort({ createdAt: -1 }).skip(skip).limit(limit)
                    .populate("actor", "_id fullName profileImageURL email")
                    .populate("blog", "title slug coverImageURL createdAt")
                    .populate("request")
                    .populate({ path: "messageRef", select: "text senderId receiverId likes createdAt status isRead deleted", populate: { path: "senderId", select: "_id fullName profileImageURL" } })
                    .lean(),
                Notification.countDocuments(notificationFilter)
            ]);
            return { notifications, total, pages: Math.ceil(total / limit), currentPage: page };
        } catch (error) {
            console.error("Error getting notifications:", error.message);
            return { notifications: [], total: 0, pages: 0, currentPage: 1 };
        }
    }

    static async markAsRead(notificationId, userId) { return Notification.findOneAndUpdate({ _id: notificationId, recipient: userId }, { $set: { isRead: true } }, { new: true }); }
    static async markAllAsRead(userId) { return Notification.updateMany({ recipient: userId, isRead: false, type: { $ne: "message" } }, { $set: { isRead: true } }); }
    static async getUnreadCount(userId) { return Notification.countDocuments({ recipient: userId, isRead: false, type: { $ne: "message" } }); }
    static async deleteNotification(notificationId, userId) { return Notification.findOneAndDelete({ _id: notificationId, recipient: userId }); }
    static async deleteAllNotifications(userId) { return Notification.deleteMany({ recipient: userId, type: { $ne: "message" } }); }
    static async getUnreadNotifications(userId, limit = 5) {
        return Notification.find({ recipient: userId, isRead: false, type: { $ne: "message" } }).sort({ createdAt: -1 }).limit(parseInt(limit))
            .populate("actor", "_id fullName profileImageURL")
            .populate("blog", "title slug coverImageURL")
            .populate("request")
            .populate({ path: "messageRef", select: "text senderId receiverId likes createdAt status isRead deleted", populate: { path: "senderId", select: "_id fullName profileImageURL" } })
            .lean();
    }
}

module.exports = NotificationService;
