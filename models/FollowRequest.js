const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const FollowRequestSchema = new Schema({
    requester: { type: Schema.Types.ObjectId, ref: "user", required: true },
    recipient: { type: Schema.Types.ObjectId, ref: "user", required: true },
    status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" },
    respondedAt: { type: Date }
}, { timestamps: true });

FollowRequestSchema.index({ requester: 1, recipient: 1 }, { unique: true });
FollowRequestSchema.index({ recipient: 1, status: 1, createdAt: -1 });

module.exports = mongoose.models.FollowRequest || model("FollowRequest", FollowRequestSchema);
