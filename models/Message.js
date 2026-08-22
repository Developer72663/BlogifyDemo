const mongoose = require("mongoose");

const reactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    emoji: { type: String, trim: true, maxlength: 8, required: true },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, index: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, index: true },
    text: { type: String, trim: true, maxlength: 5000, default: "" },
    mediaUrl: { type: String, trim: true, default: "" },
    mediaType: { type: String, enum: ["image", "video", "audio", "profile", ""], default: "" },
    profileShareId: { type: mongoose.Schema.Types.ObjectId, ref: "user", default: null },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    status: { type: String, enum: ["sent", "delivered", "read"], default: "sent" },
    isRead: { type: Boolean, default: false, index: true },
    edited: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
    // Per-user soft deletion. The message document remains available to the
    // other participant and can still be unsent for everyone by its sender.
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "user", index: true }],
    savedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "user", index: true }],
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "user" }],
    reactions: { type: [reactionSchema], default: [] },
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ receiverId: 1, isRead: 1 });
messageSchema.index({ conversationId: 1, deletedFor: 1, createdAt: 1 });

module.exports = mongoose.model("Message", messageSchema);
