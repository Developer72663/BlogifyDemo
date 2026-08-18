const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const PushSubscriptionSchema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: "user", required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
        p256dh: { type: String, required: true },
        auth: { type: String, required: true }
    },
    deviceName: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    lastUsedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
});

PushSubscriptionSchema.index({ user: 1, createdAt: -1 });

const PushSubscription = mongoose.models.PushSubscription || model("PushSubscription", PushSubscriptionSchema);
module.exports = PushSubscription;
