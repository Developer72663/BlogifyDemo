const mongoose = require("mongoose");

const { Schema } = mongoose;

const CommentSchema = new Schema(
  {
    content: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 5000,
    },

    blog: {
      type: Schema.Types.ObjectId,
      ref: "blog",
      required: true,
      index: true,
    },

    author: {
      type: Schema.Types.ObjectId,
      ref: "user",
      required: true,
      index: true,
    },

    parentComment: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
      index: true,
    },

    // Kept for compatibility with the existing UI/data model. The route does
    // not depend on this array; replies are derived from parentComment.
    replies: [
      {
        type: Schema.Types.ObjectId,
        ref: "Comment",
      },
    ],

    likes: [
      {
        type: Schema.Types.ObjectId,
        ref: "user",
      },
    ],

    isApproved: {
      type: Boolean,
      default: true,
      index: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

CommentSchema.index({
  blog: 1,
  isDeleted: 1,
  isApproved: 1,
  createdAt: 1,
});

CommentSchema.index({
  blog: 1,
  parentComment: 1,
  isDeleted: 1,
  isApproved: 1,
  createdAt: 1,
});

CommentSchema.virtual("likeCount").get(function () {
  return Array.isArray(this.likes) ? this.likes.length : 0;
});

CommentSchema.set("toJSON", { virtuals: true });
CommentSchema.set("toObject", { virtuals: true });

CommentSchema.query.notDeleted = function () {
  return this.where({ isDeleted: false });
};

CommentSchema.query.approved = function () {
  return this.where({ isApproved: true });
};

module.exports = mongoose.models.Comment || mongoose.model("Comment", CommentSchema);
