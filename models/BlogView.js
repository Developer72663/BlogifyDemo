const mongoose = require('mongoose');

const BlogViewSchema = new mongoose.Schema({
    blog: { type: mongoose.Schema.Types.ObjectId, ref: 'blog', required: true },
    viewerKey: { type: String, required: true },
    bucket: { type: Number, required: true },
    isAuthenticated: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now, expires: 90 * 24 * 60 * 60 }
}, { versionKey: false });

BlogViewSchema.index({ blog: 1, viewerKey: 1, bucket: 1 }, { unique: true });
BlogViewSchema.index({ blog: 1, createdAt: -1 });

module.exports = mongoose.models.BlogView || mongoose.model('BlogView', BlogViewSchema);
