const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const CommentSchema = new Schema({
    content: {
        type: String,
        required: true,
        minlength: 1,
        maxlength: 5000,
        trim: true
    },

    blog: {
        type: Schema.Types.ObjectId,
        ref: "blog",
        required: true,
        index: true
    },

    author: {
        type: Schema.Types.ObjectId,
        ref: "user",
        required: true,
        index: true
    },

    // Nested replies. The route validates that a parent belongs to the same blog.
    parentComment: {
        type: Schema.Types.ObjectId,
        ref: "Comment",
        default: null,
        index: true
    },

    replies: [{
        type: Schema.Types.ObjectId,
        ref: "Comment"
    }],

    // Engagement
    likes: [{ type: Schema.Types.ObjectId, ref: "user" }],

    // Moderation
    isApproved: { type: Boolean, default: true, index: true },
    isDeleted: { type: Boolean, default: false, index: true },

}, { timestamps: true });

// The comment reader queries by blog/moderation state and then sorts by creation time.
CommentSchema.index({ blog: 1, isDeleted: 1, isApproved: 1, createdAt: 1 });
CommentSchema.index({ blog: 1, parentComment: 1, isDeleted: 1, isApproved: 1, createdAt: 1 });

// Virtual for like count
CommentSchema.virtual("likeCount").get(function () {
    return Array.isArray(this.likes) ? this.likes.length : 0;
});

// Query helpers
CommentSchema.query.notDeleted = function () {
    return this.where({ isDeleted: false });
};

CommentSchema.query.approved = function () {
    return this.where({ isApproved: true });
};

const Comment = mongoose.models.Comment || model("Comment", CommentSchema);
module.exports = Comment;
