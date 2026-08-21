const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();
const Comment = require("../models/Comment");
const Blog = require("../models/Blog");
const User = require("../models/user");
const { restrictToLoggedInUserOnly } = require("../middlewares/authentication");
const { validateComment } = require("../middlewares/validation");
const { commentCreationLimiter } = require("../middlewares/rateLimiting");
const NotificationService = require("../services/notificationService");

const COMMENT_POPULATE = "fullName profileImageURL";

function validObjectId(value) {
  return typeof value === "string" && mongoose.Types.ObjectId.isValid(value);
}

function normalizedContent(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function getPublishedBlog(blogId) {
  if (!validObjectId(blogId)) return null;

  return Blog.findOne({
    _id: blogId,
    isDeleted: false,
    status: "published",
  })
    .select("_id createdBy status isDeleted")
    .lean();
}

async function getBlogAuthor(authorId) {
  if (!authorId) return null;

  return User.findById(authorId)
    .select("_id fullName isPrivate followers blogSettings commentSettings")
    .lean();
}

function canComment(author, userId) {
  if (!author || !userId) return false;

  if (author.blogSettings?.allowComments === false) return false;
  if (author.commentSettings?.allowComments === false) return false;

  if (!author.isPrivate) return true;

  const viewerId = userId.toString();
  return (
    author._id.toString() === viewerId ||
    (Array.isArray(author.followers) &&
      author.followers.some((id) => id.toString() === viewerId))
  );
}

function buildTree(comments) {
  const byId = new Map();
  const roots = [];

  for (const comment of comments) {
    comment.replies = [];
    byId.set(comment._id.toString(), comment);
  }

  for (const comment of comments) {
    const parentId = comment.parentComment?.toString();

    if (parentId && byId.has(parentId)) {
      byId.get(parentId).replies.push(comment);
    } else if (!parentId) {
      roots.push(comment);
    }
  }

  return roots;
}

async function loadVisibleComments(blogId) {
  return Comment.find({
    blog: blogId,
    isDeleted: false,
    isApproved: true,
  })
    .populate("author", COMMENT_POPULATE)
    .sort({ createdAt: 1 })
    .lean();
}

async function notifyBlogAuthor(blog, actor, parent) {
  if (blog.createdBy.toString() === actor._id.toString()) return;

  try {
    await NotificationService.createNotification(blog.createdBy, "comment", {
      title: parent ? "New reply" : "New comment",
      message: parent
        ? `${actor.fullName || "Someone"} replied to a comment on your blog`
        : `${actor.fullName || "Someone"} commented on your blog`,
      blog: blog._id,
      actor: actor._id,
    });
  } catch (error) {
    // Comment persistence must never depend on notification delivery.
    console.error("Comment notification error:", error.message);
  }
}

async function getComments(req, res) {
  try {
    const { blogId } = req.params;

    if (!validObjectId(blogId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid blog ID",
        comments: [],
        total: 0,
      });
    }

    const blog = await getPublishedBlog(blogId);
    if (!blog) {
      return res.status(404).json({
        success: false,
        message: "Blog not found",
        comments: [],
        total: 0,
      });
    }

    const author = await getBlogAuthor(blog.createdBy);
    if (!author) {
      return res.status(404).json({
        success: false,
        message: "Blog author not found",
        comments: [],
        total: 0,
      });
    }

    // Public blogs can be read publicly. Private blogs require the same access
    // rule used when creating a comment.
    if (author.isPrivate && !canComment(author, req.user?._id)) {
      return res.status(403).json({
        success: false,
        message: "This blog is private. Follow the author to view comments.",
        comments: [],
        total: 0,
      });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

    const allComments = await loadVisibleComments(blog._id);
    const visibleComments = allComments.filter((comment) => comment.author);
    const roots = buildTree(visibleComments);
    const start = (page - 1) * limit;
    const pagedRoots = roots.slice(start, start + limit);

    return res.json({
      success: true,
      comments: pagedRoots,
      total: visibleComments.length,
      rootTotal: roots.length,
      pages: Math.max(Math.ceil(roots.length / limit), 1),
      currentPage: page,
      currentUserId: req.user?._id?.toString() || null,
    });
  } catch (error) {
    console.error("Fetch comments error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch comments",
      comments: [],
      total: 0,
    });
  }
}

async function createComment(req, res) {
  try {
    if (!req.user?._id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please sign in again.",
      });
    }

    const { blogId } = req.params;
    const content = normalizedContent(
      typeof req.body?.content === "string"
        ? req.body.content
        : req.body?.comment
    );
    const parentCommentId = normalizedContent(req.body?.parentCommentId) || null;

    if (!validObjectId(blogId)) {
      return res.status(400).json({ success: false, message: "Invalid blog ID" });
    }

    const validation = validateComment(content);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: validation.errors[0] || "Invalid comment",
        errors: validation.errors,
      });
    }

    const blog = await getPublishedBlog(blogId);
    if (!blog) {
      return res.status(404).json({ success: false, message: "Blog not found" });
    }

    const author = await getBlogAuthor(blog.createdBy);
    if (!author) {
      return res.status(404).json({ success: false, message: "Blog author not found" });
    }

    if (!canComment(author, req.user._id)) {
      return res.status(403).json({
        success: false,
        message: author.isPrivate
          ? "Only the author and followers can comment on this private blog"
          : "Comments are disabled for this blog",
      });
    }

    let parent = null;

    if (parentCommentId) {
      if (!validObjectId(parentCommentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid reply target",
        });
      }

      // The blog condition is deliberate: a parent comment from another blog
      // can never be used as a reply target.
      parent = await Comment.findOne({
        _id: parentCommentId,
        blog: blog._id,
        isDeleted: false,
        isApproved: true,
      })
        .select("_id blog")
        .lean();

      if (!parent) {
        return res.status(400).json({
          success: false,
          message: "Invalid reply target",
        });
      }
    }

    const comment = await Comment.create({
      content,
      blog: blog._id,
      author: req.user._id,
      parentComment: parent?._id || null,
    });

    await comment.populate("author", COMMENT_POPULATE);

    await notifyBlogAuthor(blog, req.user, parent);

    return res.status(201).json({
      success: true,
      message: parent ? "Reply posted successfully" : "Comment posted successfully",
      comment,
    });
  } catch (error) {
    console.error("Create comment error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to post comment",
    });
  }
}

async function updateComment(req, res) {
  try {
    const { commentId } = req.params;

    if (!validObjectId(commentId)) {
      return res.status(400).json({ success: false, message: "Invalid comment ID" });
    }

    const content = normalizedContent(req.body?.content);
    const validation = validateComment(content);

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: validation.errors[0] || "Invalid comment",
        errors: validation.errors,
      });
    }

    const comment = await Comment.findOne({
      _id: commentId,
      isDeleted: false,
      isApproved: true,
    });

    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    if (comment.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    comment.content = content;
    await comment.save();
    await comment.populate("author", COMMENT_POPULATE);

    return res.json({ success: true, comment });
  } catch (error) {
    console.error("Update comment error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to update comment" });
  }
}

async function deleteComment(req, res) {
  try {
    const { commentId } = req.params;

    if (!validObjectId(commentId)) {
      return res.status(400).json({ success: false, message: "Invalid comment ID" });
    }

    const comment = await Comment.findOne({
      _id: commentId,
      isDeleted: false,
    });

    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    if (comment.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    comment.isDeleted = true;
    comment.content = "This comment was deleted.";
    await comment.save();

    return res.json({
      success: true,
      message: "Comment deleted",
      commentId: comment._id,
    });
  } catch (error) {
    console.error("Delete comment error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to delete comment" });
  }
}

async function toggleLike(req, res) {
  try {
    const { commentId } = req.params;

    if (!validObjectId(commentId)) {
      return res.status(400).json({ success: false, message: "Invalid comment ID" });
    }

    const comment = await Comment.findOne({
      _id: commentId,
      isDeleted: false,
      isApproved: true,
    });

    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    const blog = await getPublishedBlog(comment.blog.toString());
    if (!blog) {
      return res.status(404).json({ success: false, message: "Blog not found" });
    }

    const author = await getBlogAuthor(blog.createdBy);
    if (!author || !canComment(author, req.user._id)) {
      return res.status(403).json({ success: false, message: "You cannot like this comment" });
    }

    const userId = req.user._id.toString();
    const alreadyLiked = comment.likes.some((id) => id.toString() === userId);

    if (alreadyLiked) {
      comment.likes.pull(req.user._id);
    } else {
      comment.likes.addToSet(req.user._id);
    }

    await comment.save();

    return res.json({
      success: true,
      liked: !alreadyLiked,
      likeCount: comment.likes.length,
      commentId: comment._id,
    });
  } catch (error) {
    console.error("Comment like error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to like comment" });
  }
}

// Keep both existing read/create URL shapes so the current frontend does not
// need to change. Creation remains authenticated and rate-limited.
router.get("/blog/:blogId", getComments);
router.get("/:blogId", getComments);
router.post(
  "/blog/:blogId",
  restrictToLoggedInUserOnly,
  commentCreationLimiter,
  createComment
);
router.post(
  "/:blogId",
  restrictToLoggedInUserOnly,
  commentCreationLimiter,
  createComment
);
router.put("/:commentId", restrictToLoggedInUserOnly, updateComment);
router.delete("/:commentId", restrictToLoggedInUserOnly, deleteComment);
router.post("/:commentId/like", restrictToLoggedInUserOnly, toggleLike);

module.exports = router;
