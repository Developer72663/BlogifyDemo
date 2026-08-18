const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const BlogAnalyticsSchema = new Schema({
    blog: { type: Schema.Types.ObjectId, ref: "blog", required: true },
    author: { type: Schema.Types.ObjectId, ref: "user", required: true },
    totalViews: { type: Number, default: 0 },
    totalLikes: { type: Number, default: 0 },
    totalComments: { type: Number, default: 0 },
    totalShares: { type: Number, default: 0 },
    dailyViews: [{ date: Date, count: Number }],
    viewSource: {
        direct: { type: Number, default: 0 },
        search: { type: Number, default: 0 },
        social: { type: Number, default: 0 },
        referral: { type: Number, default: 0 },
        home: { type: Number, default: 0 },
        profile: { type: Number, default: 0 },
        notification: { type: Number, default: 0 }
    },
    deviceStats: {
        mobile: { type: Number, default: 0 },
        tablet: { type: Number, default: 0 },
        desktop: { type: Number, default: 0 }
    },
    topCountries: [{ country: String, views: Number }]
}, { timestamps: true });

BlogAnalyticsSchema.index({ blog: 1 }, { unique: true });
BlogAnalyticsSchema.index({ author: 1 });
BlogAnalyticsSchema.index({ totalViews: -1 });
BlogAnalyticsSchema.index({ totalLikes: -1 });

const BlogAnalytics = mongoose.models.BlogAnalytics || model("BlogAnalytics", BlogAnalyticsSchema);
module.exports = BlogAnalytics;
