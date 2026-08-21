const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Notification = require("../models/Notification");
const User = require("../models/user");
const mongoose = require("mongoose");
const onlineUsers = new Map();
const EDIT_WINDOW_MS = 60 * 1000;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_MEDIA_URL_LENGTH = 2048;
const ALLOWED_REACTIONS = ["❤️", "😂", "😮", "😢", "👍", "😍", "🔥", "👏", "😡", "🙏", "🎉", "💯"];

function createSocketLimiter(limit, windowMs) {
  const hits = [];
  return () => {
    const now = Date.now();
    while (hits.length && hits[0] <= now - windowMs) hits.shift();
    if (hits.length >= limit) return false;
    hits.push(now);
    return true;
  };
}

function isFollower(user, viewerId) {
  return Array.isArray(user?.followers) && user.followers.some(x => x.toString() === viewerId.toString());
}

function isBlocked(user, viewerId) {
  return Array.isArray(user?.blockedUsers) && user.blockedUsers.some(x => x.toString() === viewerId.toString());
}

function isSafeMediaUrl(value) {
  if (typeof value !== "string") return false;
  const url = value.trim();
  if (!url || url.length > MAX_MEDIA_URL_LENGTH) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && (host === "cloudinary.com" || host.endsWith(".cloudinary.com"));
  } catch (_) {
    return false;
  }
}

async function canMessage(target, senderId) {
  if (!target || isBlocked(target, senderId)) return false;
  const follows = isFollower(target, senderId);
  const setting = target.messageSettings?.whoCanMessage || "everyone";
  if (setting === "no_one") return false;
  if (setting === "followers" && !follows) return false;
  if (target.isPrivate && !follows) return false;
  return true;
}

function setupMessageSocket(io) {
  io.on("connection", (socket) => {
    const userId = socket.userId?.toString();
    if (!userId) return;
    const messageLimiter = createSocketLimiter(60, 60 * 1000);
    const actionLimiter = createSocketLimiter(120, 60 * 1000);
    const typingLimiter = createSocketLimiter(120, 60 * 1000);
    const current = onlineUsers.get(userId) || new Set();
    current.add(socket.id);
    onlineUsers.set(userId, current);

    User.findById(userId).select("_id messageSettings").lean().then(user => {
      if (user?.messageSettings?.onlineStatus !== "off") io.emit("user:online", { userId });
    }).catch(() => {});

    socket.join(`user:${userId}`);

    socket.on("conversation:join", async (conversationId) => {
      try {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) return;
        const c = await Conversation.findOne({ _id: conversationId, participants: userId }).select("_id");
        if (c) socket.join(`conversation:${conversationId}`);
      } catch (e) {
        console.error("conversation join:", e.message);
      }
    });

    socket.on("typing:start", async ({ conversationId } = {}) => {
      if (!typingLimiter()) return socket.emit("message:error", { message: "Too many realtime actions. Please slow down." });
      try {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) return;
        const [membership, sender] = await Promise.all([
          Conversation.exists({ _id: conversationId, participants: userId }),
          User.findById(userId).select("messageSettings").lean()
        ]);
        if (membership && sender?.messageSettings?.typingIndicator !== false) {
          socket.to(`conversation:${conversationId}`).emit("typing:start", { userId });
        }
      } catch (e) {
        console.error("typing:start:", e.message);
      }
    });

    socket.on("typing:stop", async ({ conversationId } = {}) => {
      if (!typingLimiter()) return;
      try {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) return;
        const allowed = await Conversation.exists({ _id: conversationId, participants: userId });
        if (allowed) socket.to(`conversation:${conversationId}`).emit("typing:stop", { userId });
      } catch (e) {
        console.error("typing:stop:", e.message);
      }
    });

    socket.on("message:send", async ({ conversationId, text = "", replyTo = null, mediaUrl = "", mediaType = "", profileShareId = null } = {}) => {
      if (!messageLimiter()) return socket.emit("message:error", { message: "You are sending messages too quickly. Please slow down." });
      try {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) return socket.emit("message:error", { message: "Invalid conversation." });
        const cleanText = typeof text === "string" ? text.trim() : "";
        const validTypes = ["image", "video", "audio"];
        const cleanMediaUrl = typeof mediaUrl === "string" ? mediaUrl.trim() : "";
        const validMedia = validTypes.includes(mediaType) && isSafeMediaUrl(cleanMediaUrl);
        if (!cleanText && !validMedia && !profileShareId) return;
        if (cleanText.length > MAX_MESSAGE_LENGTH) return socket.emit("message:error", { message: "Message is too long." });
        if (mediaUrl && !validMedia && !profileShareId) return socket.emit("message:error", { message: "Invalid media URL." });
        if (profileShareId && !mongoose.Types.ObjectId.isValid(profileShareId)) return socket.emit("message:error", { message: "Invalid profile." });

        let replyMessage = null;
        if (replyTo) {
          if (!mongoose.Types.ObjectId.isValid(replyTo)) return socket.emit("message:error", { message: "Invalid reply." });
          replyMessage = await Message.findOne({ _id: replyTo, conversationId }).select("_id");
          if (!replyMessage) return socket.emit("message:error", { message: "The message you are replying to was not found." });
        }

        const c = await Conversation.findOne({ _id: conversationId, participants: userId });
        if (!c) return socket.emit("message:error", { message: "Conversation not found." });
        const receiverId = c.participants.find(x => x.toString() !== userId);
        if (!receiverId) return socket.emit("message:error", { message: "Conversation recipient not found." });

        const [target, sender] = await Promise.all([
          User.findById(receiverId).select("_id fullName isPrivate followers blockedUsers messageSettings"),
          User.findById(userId).select("_id fullName blockedUsers followers")
        ]);
        if (!target || !sender) return socket.emit("message:error", { message: "User not found." });
        if (!await canMessage(target, userId) || isBlocked(sender, receiverId)) return socket.emit("message:error", { message: "You cannot message this user." });

        if (validMedia) {
          if (mediaType === "image" && target.messageSettings?.allowPhotoMessages === false) return socket.emit("message:error", { message: "This user does not accept photo messages." });
          if (mediaType === "video" && target.messageSettings?.allowVideoMessages === false) return socket.emit("message:error", { message: "This user does not accept video messages." });
        }

        if (profileShareId) {
          const sharedProfile = await User.findById(profileShareId).select("_id fullName profileImageURL bio isPrivate followers");
          if (!sharedProfile) return socket.emit("message:error", { message: "Profile not found." });
          if (sharedProfile.isPrivate && sharedProfile._id.toString() !== userId && !isFollower(sharedProfile, userId)) return socket.emit("message:error", { message: "You cannot share a private profile you do not follow." });
        }

        const m = await Message.create({
          conversationId,
          senderId: userId,
          receiverId,
          text: cleanText,
          mediaUrl: validMedia ? cleanMediaUrl : "",
          mediaType: profileShareId ? "profile" : validMedia ? mediaType : "",
          profileShareId: profileShareId || null,
          replyTo: replyMessage?._id || null
        });

        c.lastMessage = m._id;
        c.lastMessageAt = new Date();
        await c.save();

        const payload = await Message.findById(m._id)
          .populate("senderId", "fullName profileImageURL")
          .populate("profileShareId", "fullName profileImageURL bio isPrivate")
          .populate("replyTo", "text senderId")
          .lean();

        await Message.updateOne({ _id: m._id }, { $set: { status: "delivered" } });
        io.to(`conversation:${conversationId}`).emit("message:new", { ...payload, status: "delivered" });
        io.to(`user:${receiverId}`).emit("message:new", { ...payload, status: "delivered" });

        const notificationText = cleanText ? cleanText.substring(0, 120) : profileShareId ? "Shared a profile" : mediaType === "audio" ? "Sent a voice message" : mediaType === "video" ? "Sent a video" : "Sent a photo";
        if (target.messageSettings?.messageNotifications !== false) {
          try {
            await Notification.create({ recipient: receiverId, type: "message", title: `New message from ${socket.userName || "a user"}`, message: notificationText, actor: userId, messageRef: m._id, conversationId: c._id, isRead: false });
            io.to(`user:${receiverId}`).emit("notification:message", { conversationId, senderId: userId, messageId: m._id });
          } catch (notificationError) {
            console.error("message notification:", notificationError.message);
          }
        }
      } catch (e) {
        console.error("message socket:", e.message);
        socket.emit("message:error", { message: "Unable to send message" });
      }
    });

    socket.on("message:edit", async ({ conversationId, messageId, text = "" } = {}) => {
      if (!actionLimiter()) return socket.emit("message:action:error", { message: "Too many realtime actions. Please slow down." });
      try {
        if (!mongoose.Types.ObjectId.isValid(conversationId) || !mongoose.Types.ObjectId.isValid(messageId)) return socket.emit("message:action:error", { message: "Invalid message." });
        const cleanText = typeof text === "string" ? text.trim() : "";
        if (!cleanText || cleanText.length > MAX_MESSAGE_LENGTH) return socket.emit("message:action:error", { message: "Enter a valid message." });
        const message = await Message.findOne({ _id: messageId, conversationId, senderId: userId });
        if (!message || message.deleted) return socket.emit("message:action:error", { message: "Message is no longer available." });
        if (Date.now() - new Date(message.createdAt).getTime() > EDIT_WINDOW_MS) return socket.emit("message:action:error", { message: "Edit is available for only 1 minute." });
        if (message.mediaType || message.profileShareId) return socket.emit("message:action:error", { message: "Only text messages can be edited." });
        message.text = cleanText;
        message.edited = true;
        await message.save();
        const payload = await Message.findById(message._id).populate("senderId", "fullName profileImageURL").populate("profileShareId", "fullName profileImageURL bio isPrivate").populate("replyTo", "text senderId").lean();
        io.to(`conversation:${conversationId}`).emit("message:edited", payload);
      } catch (e) {
        console.error("message edit:", e.message);
        socket.emit("message:action:error", { message: "Unable to edit message." });
      }
    });

    socket.on("message:unsend", async ({ conversationId, messageId } = {}) => {
      if (!actionLimiter()) return socket.emit("message:action:error", { message: "Too many realtime actions. Please slow down." });
      try {
        if (!mongoose.Types.ObjectId.isValid(conversationId) || !mongoose.Types.ObjectId.isValid(messageId)) return socket.emit("message:action:error", { message: "Invalid message." });
        const message = await Message.findOne({ _id: messageId, conversationId, senderId: userId });
        if (!message) return socket.emit("message:action:error", { message: "Message not found." });
        message.text = ""; message.mediaUrl = ""; message.mediaType = ""; message.profileShareId = null; message.deleted = true; message.edited = false;
        await message.save();
        io.to(`conversation:${conversationId}`).emit("message:unsent", { messageId: message._id.toString(), conversationId: conversationId.toString() });
      } catch (e) {
        console.error("message unsend:", e.message);
        socket.emit("message:action:error", { message: "Unable to unsend message." });
      }
    });

    socket.on("message:react", async ({ conversationId, messageId, emoji } = {}) => {
      if (!actionLimiter()) return socket.emit("message:action:error", { message: "Too many realtime actions. Please slow down." });
      try {
        if (!mongoose.Types.ObjectId.isValid(conversationId) || !mongoose.Types.ObjectId.isValid(messageId)) return socket.emit("message:action:error", { message: "Invalid message." });
        if (!ALLOWED_REACTIONS.includes(emoji)) return socket.emit("message:action:error", { message: "Unsupported reaction." });
        const message = await Message.findOne({ _id: messageId, conversationId, $or: [{ senderId: userId }, { receiverId: userId }] });
        if (!message || message.deleted) return socket.emit("message:action:error", { message: "Message not found." });
        const existing = message.reactions.find(r => r.userId.toString() === userId);
        if (existing && existing.emoji === emoji) message.reactions = message.reactions.filter(r => r.userId.toString() !== userId);
        else if (existing) existing.emoji = emoji;
        else message.reactions.push({ userId, emoji });
        await message.save();
        io.to(`conversation:${conversationId}`).emit("message:reactions", { messageId: message._id.toString(), conversationId: conversationId.toString(), reactions: message.reactions.map(r => ({ userId: r.userId.toString(), emoji: r.emoji })) });
      } catch (e) {
        console.error("message reaction:", e.message);
        socket.emit("message:action:error", { message: "Unable to update reaction." });
      }
    });

    socket.on("message:read", async ({ conversationId } = {}) => {
      if (!actionLimiter()) return;
      try {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) return;
        const [c, reader] = await Promise.all([
          Conversation.findOne({ _id: conversationId, participants: userId }).select("_id participants"),
          User.findById(userId).select("messageSettings").lean()
        ]);
        if (!c) return;
        const otherId = c.participants.find(x => x.toString() !== userId);
        await Message.updateMany({ conversationId, receiverId: userId, isRead: false }, { $set: { isRead: true, status: "read" } });
        await Notification.updateMany({ recipient: userId, type: "message", actor: otherId, isRead: false }, { $set: { isRead: true } });
        if (reader?.messageSettings?.readReceipts !== false) io.to(`conversation:${conversationId}`).emit("message:read", { conversationId, userId });
      } catch (e) {
        console.error("message read:", e.message);
      }
    });

    socket.on("disconnect", async () => {
      const set = onlineUsers.get(userId);
      if (!set) return;
      set.delete(socket.id);
      if (!set.size) {
        onlineUsers.delete(userId);
        try {
          const user = await User.findById(userId).select("messageSettings").lean();
          if (user?.messageSettings?.onlineStatus !== "off") io.emit("user:offline", { userId });
        } catch (_) {}
      }
    });
  });
  return onlineUsers;
}

module.exports = { setupMessageSocket, onlineUsers };
