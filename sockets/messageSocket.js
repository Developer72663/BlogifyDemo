const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const NotificationService = require("../services/notificationService");
const Notification = require("../models/Notification");
const User = require("../models/user");
const mongoose = require("mongoose");
const onlineUsers = new Map();
const activeChatBySocket = global.__BLOGIFY_ACTIVE_CHAT_BY_SOCKET || new Map();
global.__BLOGIFY_ACTIVE_CHAT_BY_SOCKET = activeChatBySocket;
const EDIT_WINDOW_MS = 60 * 1000;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_MEDIA_URL_LENGTH = 2048;

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

function isSafeMediaUrl(value) {
  if (typeof value !== "string") return false;
  const url = value.trim();
  if (!url || url.length > MAX_MEDIA_URL_LENGTH) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch (_) {
    return false;
  }
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
    activeChatBySocket.set(socket.id, { userId, conversationId: null });
    socket.join(`user:${userId}`);
    io.emit("user:online", { userId });

    const setActiveConversation = async (conversationId) => {
      if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) return false;
      const c = await Conversation.findOne({ _id: conversationId, participants: userId }).select("_id");
      if (!c) return false;
      const previous = activeChatBySocket.get(socket.id)?.conversationId;
      if (previous && previous !== String(conversationId)) socket.leave(`conversation:${previous}`);
      socket.join(`conversation:${conversationId}`);
      activeChatBySocket.set(socket.id, { userId, conversationId: String(conversationId) });
      return true;
    };

    socket.on("conversation:join", async (conversationId) => {
      try { await setActiveConversation(conversationId); }
      catch (e) { console.error("conversation join:", e.message); }
    });

    socket.on("conversation:active", async (conversationId) => {
      try { await setActiveConversation(conversationId); }
      catch (e) { console.error("conversation active:", e.message); }
    });

    socket.on("conversation:leave", (conversationId) => {
      const state = activeChatBySocket.get(socket.id);
      if (!state) return;
      const target = conversationId ? String(conversationId) : state.conversationId;
      if (target) socket.leave(`conversation:${target}`);
      if (!conversationId || target === state.conversationId) {
        activeChatBySocket.set(socket.id, { userId, conversationId: null });
      }
    });

    socket.on("typing:start", async ({ conversationId } = {}) => {
      if (!typingLimiter()) return socket.emit("message:error", { message: "Too many realtime actions. Please slow down." });
      try {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) return;
        if (await Conversation.exists({ _id: conversationId, participants: userId })) socket.to(`conversation:${conversationId}`).emit("typing:start", { userId });
      } catch (e) { console.error("typing:start:", e.message); }
    });

    socket.on("typing:stop", async ({ conversationId } = {}) => {
      if (!typingLimiter()) return;
      try {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) return;
        if (await Conversation.exists({ _id: conversationId, participants: userId })) socket.to(`conversation:${conversationId}`).emit("typing:stop", { userId });
      } catch (e) { console.error("typing:stop:", e.message); }
    });

    socket.on("message:send", async ({ conversationId, text = "", replyTo = null, mediaUrl = "", mediaType = "", profileShareId = null } = {}) => {
      if (!messageLimiter()) return socket.emit("message:error", { message: "You are sending messages too quickly. Please slow down." });
      try {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) return socket.emit("message:error", { message: "Invalid conversation." });
        const cleanText = typeof text === "string" ? text.trim() : "";
        const validTypes = ["image", "video", "audio", "profile"];
        const cleanMediaUrl = typeof mediaUrl === "string" ? mediaUrl.trim() : "";
        const validMedia = validTypes.includes(mediaType) && mediaType !== "profile" && isSafeMediaUrl(cleanMediaUrl);
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
          User.findById(receiverId).select("_id fullName isPrivate followers blockedUsers"),
          User.findById(userId).select("_id fullName blockedUsers profileImageURL")
        ]);
        if (!target || !sender) return socket.emit("message:error", { message: "User not found." });
        if (target.blockedUsers?.some(x => x.toString() === userId) || sender.blockedUsers?.some(x => x.toString() === receiverId.toString())) return socket.emit("message:error", { message: "You cannot message this user." });
        if (target.isPrivate && !target.followers.some(x => x.toString() === userId)) return socket.emit("message:error", { message: "This account is private. Follow the user before messaging." });
        if (profileShareId) {
          const sharedProfile = await User.findById(profileShareId).select("_id");
          if (!sharedProfile) return socket.emit("message:error", { message: "Profile not found." });
        }

        const m = await Message.create({ conversationId, senderId: userId, receiverId, text: cleanText, mediaUrl: validMedia ? cleanMediaUrl : "", mediaType: profileShareId ? "profile" : validMedia ? mediaType : "", profileShareId: profileShareId || null, replyTo: replyMessage?._id || null });
        c.lastMessage = m._id;
        c.lastMessageAt = new Date();

        // Emit the canonical message as soon as the durable message exists.
        // Do not make realtime delivery wait for notification creation or expensive
        // populate queries. The sender data was already authorized above.
        const livePayload = {
          _id: m._id,
          conversationId: m.conversationId,
          senderId: { _id: sender._id, fullName: sender.fullName, profileImageURL: sender.profileImageURL },
          receiverId: m.receiverId,
          text: m.text,
          mediaUrl: m.mediaUrl,
          mediaType: m.mediaType,
          profileShareId: m.profileShareId,
          replyTo: m.replyTo,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
          status: "delivered"
        };
        io.to(`conversation:${conversationId}`).emit("message:new", livePayload);
        io.to(`user:${receiverId}`).emit("message:new", livePayload);
        io.to(`user:${userId}`).emit("message:new", livePayload);

        // Conversation metadata persistence and rich population are deliberately
        // outside the realtime critical path.
        void c.save().catch(error => console.error("conversation save:", error.message));
        void Message.updateOne({ _id: m._id }, { $set: { status: "delivered" } }).catch(error => console.error("message delivery status:", error.message));

        const notificationText = cleanText ? cleanText.substring(0, 120) : profileShareId ? "Shared a profile" : mediaType === "audio" ? "Sent a voice message" : mediaType === "video" ? "Sent a video" : "Sent a photo";
        const recipientIsInThisChat = [...activeChatBySocket.values()].some(state => state?.userId === receiverId.toString() && state?.conversationId === conversationId.toString());
        if (!recipientIsInThisChat) {
          void (async () => {
            try {
              await NotificationService.createNotification(receiverId, "message", {
                title: `New message from ${socket.userName || "a user"}`,
                message: notificationText,
                actor: userId,
                messageRef: m._id,
                conversationId: c._id
              });
              io.to(`user:${receiverId}`).emit("notification:message", { conversationId, senderId: userId, messageId: m._id });
            } catch (notificationError) {
              console.error("message notification:", notificationError.message);
            }
          })();
        } else {
          io.to(`user:${receiverId}`).emit("notification:message", { conversationId, senderId: userId, messageId: m._id, pushSuppressed: true });
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
        message.text = cleanText; message.edited = true; await message.save();
        const payload = await Message.findById(message._id).populate("senderId", "fullName profileImageURL").populate("profileShareId", "fullName profileImageURL bio isPrivate").populate("replyTo", "text senderId").lean();
        io.to(`conversation:${conversationId}`).emit("message:edited", payload);
      } catch (e) { console.error("message edit:", e.message); socket.emit("message:action:error", { message: "Unable to edit message." }); }
    });

    socket.on("message:unsend", async ({ conversationId, messageId } = {}) => {
      if (!actionLimiter()) return socket.emit("message:action:error", { message: "Too many realtime actions. Please slow down." });
      try {
        if (!mongoose.Types.ObjectId.isValid(conversationId) || !mongoose.Types.ObjectId.isValid(messageId)) return socket.emit("message:action:error", { message: "Invalid message." });
        const message = await Message.findOne({ _id: messageId, conversationId, senderId: userId });
        if (!message) return socket.emit("message:action:error", { message: "Message not found." });
        message.text = ""; message.mediaUrl = ""; message.mediaType = ""; message.profileShareId = null; message.deleted = true; message.edited = false; await message.save();
        io.to(`conversation:${conversationId}`).emit("message:unsent", { messageId: message._id.toString(), conversationId: conversationId.toString() });
      } catch (e) { console.error("message unsend:", e.message); socket.emit("message:action:error", { message: "Unable to unsend message." }); }
    });

    socket.on("message:react", async ({ conversationId, messageId, emoji } = {}) => {
      if (!actionLimiter()) return socket.emit("message:action:error", { message: "Too many realtime actions. Please slow down." });
      try {
        if (!mongoose.Types.ObjectId.isValid(conversationId) || !mongoose.Types.ObjectId.isValid(messageId)) return socket.emit("message:action:error", { message: "Invalid message." });
        const allowed = ["❤️", "😂", "😮", "😢", "👍", "😍", "🔥", "👏", "😡", "🙏", "🎉", "💯"];
        if (!allowed.includes(emoji)) return socket.emit("message:action:error", { message: "Unsupported reaction." });
        const message = await Message.findOne({ _id: messageId, conversationId, $or: [{ senderId: userId }, { receiverId: userId }] });
        if (!message || message.deleted) return socket.emit("message:action:error", { message: "Message not found." });
        const existing = message.reactions.find(r => r.userId.toString() === userId);
        if (existing && existing.emoji === emoji) message.reactions = message.reactions.filter(r => r.userId.toString() !== userId);
        else if (existing) existing.emoji = emoji;
        else message.reactions.push({ userId, emoji });
        await message.save();
        io.to(`conversation:${conversationId}`).emit("message:reactions", { messageId: message._id.toString(), conversationId: conversationId.toString(), reactions: message.reactions.map(r => ({ userId: r.userId.toString(), emoji: r.emoji })) });
      } catch (e) { console.error("message reaction:", e.message); socket.emit("message:action:error", { message: "Unable to update reaction." }); }
    });

    socket.on("message:read", async ({ conversationId } = {}) => {
      if (!actionLimiter()) return;
      try {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) return;
        const c = await Conversation.findOne({ _id: conversationId, participants: userId }).select("_id participants");
        if (!c) return;
        const otherId = c.participants.find(x => x.toString() !== userId);
        await Message.updateMany({ conversationId, receiverId: userId, isRead: false }, { $set: { isRead: true, status: "read" } });
        await Notification.updateMany({ recipient: userId, type: "message", actor: otherId, isRead: false }, { $set: { isRead: true } });
        io.to(`conversation:${conversationId}`).emit("message:read", { conversationId, userId });
        io.to(`user:${userId}`).emit("message:read", { conversationId, userId });
      } catch (e) { console.error("message read:", e.message); }
    });

    socket.on("disconnect", () => {
      activeChatBySocket.delete(socket.id);
      const set = onlineUsers.get(userId);
      if (!set) return;
      set.delete(socket.id);
      if (!set.size) { onlineUsers.delete(userId); io.emit("user:offline", { userId }); }
    });
  });
  return onlineUsers;
}

module.exports = { setupMessageSocket, onlineUsers, activeChatBySocket };
