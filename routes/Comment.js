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

function isValidObjectId(value) {
    return typeof value === "string" && mongoose.Types.ObjectId.isValid(value);
}

async function canAccessBlog(blog, viewerId) {
    if (!blog) return false;

    const author = await User.findById(blog.createdBy)
        .select("_id isPrivate followers")
        .lean();

    if (!author) return false;

    // Public blogs can be read, including their approved comments, without login.
    if (!author.isPrivate) return true;

    // Private blogs require the author or a follower.
    if (!viewerId) return false;
    const viewer = viewerId.toString();
    return author._id.toString() === viewer ||
        (Array.isArray(author.followers) && author.followers.some(id => id.toString() === viewer));
}

function commentsAllowed(author) {
    return !!author &&
        author.blogSettings?.allowComments !== false &&
        author.commentSettings?.allowComments !== false;
}

function buildCommentTree(comments) {
    const map = new Map();
    const roots = [];

    for (const comment of comments) {
        comment.replies = [];
        map.set(comment._id.toString(), comment);
    }

    for (const comment of comments) {
        const parentId = comment.parentComment?.toString();
        if (parentId && map.has(parentId)) {
            map.get(parentId).replies.push(comment);
        } else if (!parentId) {
            roots.push(comment);
        }
    }

    return roots;
}

async function loadBlogForComments(blogId) {
    if (!isValidObjectId(blogId)) return null;

    return Blog.findOne({
        _id: blogId,
        isDeleted: false,
        status: "published"
    })
        .select("_id createdBy isDeleted status")
        .lean();
}

async function getComments(req, res) {
    try {
        const { blogId } = req.params;
        if (!isValidObjectId(blogId)) {
            return res.status(400).json({ success: false, message: "Invalid blog ID", comments: [], total: 0 });
        }

        const blog = await loadBlogForComments(blogId);
        if (!blog) {
            return res.status(404).json({ success: false, message: "Blog not found", comments: [], total: 0 });
        }

        if (!(await canAccessBlog(blog, req.user?._id))) {
            return res.status(403).json({
                success: false,
                message: "This blog is private. Follow the author to view comments.",
                comments: [],
                total: 0
            });
        }

        const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);

        const allComments = await Comment.find({
            blog: blog._id,
            isDeleted: false,
            isApproved: true
        })
            .populate("author", "fullName profileImageURL")
            .sort({ createdAt: 1 })
            .lean();

        const safeComments = allComments.filter(comment => comment.author);
        const roots = buildCommentTree(safeComments);
        const start = (page - 1) * limit;

        return res.json({
            success: true,
            comments: roots.slice(start, start + limit),
            total: safeComments.length,
            rootTotal: roots.length,
            pages: Math.max(Math.ceil(roots.length / limit), 1),
            currentPage: page,
            currentUserId: req.user?._id?.toString() || null
        });
    } catch (error) {
        console.error("Fetch comments error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to fetch comments", comments: [], total: 0 });
    }
}

async function createComment(req, res) {
    try {
        if (!req.user?._id) {
            return res.status(401).json({ success: false, message: "Authentication required. Please sign in again." });
        }

        const { blogId } = req.params;
        const rawContent = typeof req.body?.content === "string"
            ? req.body.content
            : typeof req.body?.comment === "string"
                ? req.body.comment
                : "";
        const content = rawContent.trim();
        const parentCommentId = typeof req.body?.parentCommentId === "string"
            ? req.body.parentCommentId.trim()
            : null;

        if (!isValidObjectId(blogId)) {
            return res.status(400).json({ success: false, message: "Invalid blog ID" });
        }

        const validation = validateComment(content);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: validation.errors[0] || "Invalid comment",
                errors: validation.errors
            });
        }

        const blog = await loadBlogForComments(blogId);
        if (!blog) {
            return res.status(404).json({ success: false, message: "Blog not found" });
        }

        if (!(await canAccessBlog(blog, req.user._id))) {
            return res.status(403).json({
                success: false,
                message: "Only the author and followers can comment on this private blog"
            });
        }

        const blogAuthor = await User.findById(blog.createdBy)
            .select("_id fullName isPrivate followers blogSettings commentSettings")
            .lean();

        if (!blogAuthor) {
            return res.status(404).json({ success: false, message: "Blog author not found" });
        }

        if (!commentsAllowed(blogAuthor)) {
            return res.status(403).json({ success: false, message: "Comments are disabled for this blog" });
        }

        let parent = null;
        if (parentCommentId) {
            if (!isValidObjectId(parentCommentId)) {
                return res.status(400).json({ success: false, message: "Invalid reply target" });
            }

            parent = await Comment.findOne({
                _id: parentCommentId,
                blog: blog._id,
                isDeleted: false,
                isApproved: true
            }).select("_id blog parentComment").lean();

            if (!parent) {
                return res.status(400).json({ success: false, message: "Invalid reply target" });
            }
        }

        const comment = await Comment.create({
            content,
            blog: blog._id,
            author: req.user._id,
            parentComment: parent?._id || null
        });

        await comment.populate("author", "fullName profileImageURL");

        if (blog.createdBy.toString() !== req.user._id.toString()) {
            try {
                await NotificationService.createNotification(
                    blog.createdBy,
                    "comment",
                    {
                        title: parent ? "New reply" : "New comment",
                        message: parent
                            ? `${req.user.fullName || "Someone"} replied to a comment on your blog`
                            : `${req.user.fullName || "Someone"} commented on your blog`,
                        blog: blog._id,
                        actor: req.user._id
                    }
                );
            } catch (notificationError) {
                console.error("Comment notification error:", notificationError.message);
            }
        }

        return res.status(201).json({
            success: true,
            message: parent ? "Reply posted successfully" : "Comment posted successfully",
            comment
        });
    } catch (error) {
        console.error("Create comment error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to post comment" });
    }
}

router.get("/blog/:blogId", getComments);
router.get("/:blogId", getComments);
router.post("/blog/:blogId", restrictToLoggedInUserOnly, commentCreationLimiter, createComment);
router.post("/:blogId", restrictToLoggedInUserOnly, commentCreationLimiter, createComment);

router.put("/:commentId", restrictToLoggedInUserOnly, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.commentId)) return res.status(400).json({ success: false, message: "Invalid comment ID" });
        const validation = validateComment(req.body?.content);
        if (!validation.isValid) return res.status(400).json({ success: false, errors: validation.errors });

        const comment = await Comment.findOne({ _id: req.params.commentId, isDeleted: false });
        if (!comment) return res.status(404).json({ success: false, message: "Comment not found" });
        if (comment.author.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, message: "Not authorized" });

        comment.content = req.body.content.trim();
        await comment.save();
        await comment.populate("author", "fullName profileImageURL");
        return res.json({ success: true, comment });
    } catch (error) {
        console.error("Update comment error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to update comment" });
    }
});

router.delete("/:commentId", restrictToLoggedInUserOnly, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.commentId)) return res.status(400).json({ success: false, message: "Invalid comment ID" });

        const comment = await Comment.findOne({ _id: req.params.commentId, isDeleted: false });
        if (!comment) return res.status(404).json({ success: false, message: "Comment not found" });
        if (comment.author.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, message: "Not authorized" });

        comment.isDeleted = true;
        comment.content = "This comment was deleted.";
        await comment.save();
        return res.json({ success: true, message: "Comment deleted" });
    } catch (error) {
        console.error("Delete comment error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to delete comment" });
    }
});

router.post("/:commentId/like", restrictToLoggedInUserOnly, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.commentId)) return res.status(400).json({ success: false, message: "Invalid comment ID" });

        const comment = await Comment.findOne({ _id: req.params.commentId, isDeleted: false });
        if (!comment) return res.status(404).json({ success: false, message: "Comment not found" });

        const blog = await Blog.findOne({ _id: comment.blog, isDeleted: false, status: "published" })
            .select("_id createdBy isDeleted status")
            .lean();
        if (!blog || !(await canAccessBlog(blog, req.user._id))) {
            return res.status(403).json({ success: false, message: "You cannot like this comment" });
        }

        const userId = req.user._id.toString();
        const hasLiked = comment.likes.some(id => id.toString() === userId);
        if (hasLiked) comment.likes = comment.likes.filter(id => id.toString() !== userId);
        else comment.likes.push(req.user._id);

        await comment.save();
        return res.json({ success: true, liked: !hasLiked, likeCount: comment.likes.length, commentId: comment._id });
    } catch (error) {
        console.error("Comment like error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to like comment" });
    }
});

module.exports = router;
