const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Comment = require("../models/Comment");
const Blog = require("../models/Blog");
const User = require("../models/user");
const { restrictToLoggedInUserOnly } = require("../middlewares/authentication");
const { validateComment } = require("../middlewares/validation");
const NotificationService = require("../services/notificationService");

async function canAccessBlog(blog, viewerId) {
    const author = await User.findById(blog.createdBy).select("isPrivate followers").lean();
    if (!author) return false;
    if (!author.isPrivate) return true;
    if (!viewerId) return false;
    return author._id.toString() === viewerId.toString() ||
        (Array.isArray(author.followers) && author.followers.some(id => id.toString() === viewerId.toString()));
}

function buildCommentTree(comments) {
    const map = new Map();
    const roots = [];

    for (const comment of comments) {
        comment.replies = [];
        map.set(comment._id.toString(), comment);
    }

    for (const comment of comments) {
        const parentId = comment.parentComment ? comment.parentComment.toString() : null;
        if (parentId && map.has(parentId)) {
            map.get(parentId).replies.push(comment);
        } else if (!parentId) {
            roots.push(comment);
        }
    }

    return roots;
}

async function getComments(req, res) {
    try {
        const { blogId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(blogId)) {
            return res.status(400).json({ success: false, message: "Invalid blog ID", comments: [], total: 0 });
        }

        const blog = await Blog.findById(blogId).select("_id createdBy isDeleted").lean();
        if (!blog || blog.isDeleted) {
            return res.status(404).json({ success: false, message: "Blog not found", comments: [], total: 0 });
        }

        const viewerId = req.user?._id || null;
        if (!(await canAccessBlog(blog, viewerId))) {
            return res.status(403).json({
                success: false,
                message: "Only the author and followers can view comments on this private blog",
                comments: [],
                total: 0
            });
        }

        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

        const allComments = await Comment.find({ blog: blogId, isDeleted: false })
            .populate("author", "fullName profileImageURL")
            .sort({ createdAt: 1 })
            .lean();

        // Do not let a stale/deleted author break the entire comments panel.
        const safeComments = allComments.filter(comment => comment.author);
        const roots = buildCommentTree(safeComments);
        const total = safeComments.length;
        const start = (page - 1) * limit;
        const pagedRoots = roots.slice(start, start + limit);

        return res.json({
            success: true,
            comments: pagedRoots,
            total,
            rootTotal: roots.length,
            pages: Math.max(Math.ceil(roots.length / limit), 1),
            currentPage: page,
            currentUserId: req.user?._id?.toString() || null
        });
    } catch (error) {
        console.error("Fetch comments error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch comments",
            comments: [],
            total: 0
        });
    }
}

// Public comment reads for public blogs.
router.get("/blog/:blogId", getComments);

// Backward-compatible alias for older view.ejs builds that request /comments/:blogId.
router.get("/:blogId", getComments);

// All write operations require authentication.
router.post("/blog/:blogId", restrictToLoggedInUserOnly, async (req, res) => {
    try {
        const { content, parentCommentId } = req.body;
        const validation = validateComment(content);
        if (!validation.isValid) return res.status(400).json({ success: false, errors: validation.errors });

        const blog = await Blog.findById(req.params.blogId);
        if (!blog || blog.isDeleted) return res.status(404).json({ success: false, message: "Blog not found" });
        if (!(await canAccessBlog(blog, req.user._id))) {
            return res.status(403).json({ success: false, message: "Only followers can comment on this private blog" });
        }

        let parent = null;
        if (parentCommentId) {
            parent = await Comment.findOne({ _id: parentCommentId, blog: blog._id, isDeleted: false });
            if (!parent) return res.status(400).json({ success: false, message: "Invalid reply target" });
        }

        const comment = await Comment.create({
            content: content.trim(),
            blog: blog._id,
            author: req.user._id,
            parentComment: parent ? parent._id : null
        });

        await comment.populate("author", "fullName profileImageURL");

        if (blog.createdBy.toString() !== req.user._id.toString()) {
            try {
                await NotificationService.createNotification(blog.createdBy, "comment", {
                    title: parent ? "New reply" : "New comment",
                    message: parent ? `${req.user.fullName} replied to a comment on your blog` : `${req.user.fullName} commented on your blog`,
                    blog: blog._id,
                    actor: req.user._id
                });
            } catch (notificationError) {
                console.error("Comment notification error:", notificationError);
            }
        }

        res.status(201).json({ success: true, comment });
    } catch (error) {
        console.error("Create comment error:", error);
        res.status(500).json({ success: false, message: "Failed to post comment" });
    }
});

// Backward-compatible write alias.
router.post("/:blogId", restrictToLoggedInUserOnly, async (req, res, next) => {
    req.url = `/blog/${req.params.blogId}`;
    return next();
});

router.put("/:commentId", restrictToLoggedInUserOnly, async (req, res) => {
    try {
        const validation = validateComment(req.body.content);
        if (!validation.isValid) return res.status(400).json({ success: false, errors: validation.errors });
        const comment = await Comment.findById(req.params.commentId);
        if (!comment) return res.status(404).json({ success: false, message: "Comment not found" });
        if (comment.author.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, message: "Not authorized" });
        comment.content = req.body.content.trim();
        await comment.save();
        res.json({ success: true, comment });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to update comment" });
    }
});

router.delete("/:commentId", restrictToLoggedInUserOnly, async (req, res) => {
    try {
        const comment = await Comment.findById(req.params.commentId);
        if (!comment) return res.status(404).json({ success: false, message: "Comment not found" });
        if (comment.author.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, message: "Not authorized" });
        comment.isDeleted = true;
        comment.content = "This comment was deleted.";
        await comment.save();
        res.json({ success: true, message: "Comment deleted" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to delete comment" });
    }
});

router.post("/:commentId/like", restrictToLoggedInUserOnly, async (req, res) => {
    try {
        const comment = await Comment.findById(req.params.commentId);
        if (!comment || comment.isDeleted) return res.status(404).json({ success: false, message: "Comment not found" });
        const blog = await Blog.findById(comment.blog);
        if (!blog || !(await canAccessBlog(blog, req.user._id))) {
            return res.status(403).json({ success: false, message: "Only followers can like comments on this private blog" });
        }

        const userId = req.user._id.toString();
        const hasLiked = comment.likes.some(id => id.toString() === userId);
        if (hasLiked) comment.likes = comment.likes.filter(id => id.toString() !== userId);
        else comment.likes.push(req.user._id);
        await comment.save();

        res.json({ success: true, liked: !hasLiked, likeCount: comment.likes.length, commentId: comment._id });
    } catch (error) {
        console.error("Comment like error:", error);
        res.status(500).json({ success: false, message: "Failed to like comment" });
    }
});

module.exports = router;
