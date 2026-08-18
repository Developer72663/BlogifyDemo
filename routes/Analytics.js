const express = require("express");
const router = express.Router();
const { restrictToLoggedInUserOnly } = require("../middlewares/authentication");
const AnalyticsService = require("../services/analyticsService");
const Blog = require("../models/Blog");

router.get("/trending", async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);
        const trendingBlogs = await AnalyticsService.getTrendingBlogs(limit, req.user?._id);
        res.json({ success: true, blogs: trendingBlogs });
    } catch (error) {
        console.error("Error fetching trending blogs:", error);
        res.status(500).json({ success: false, message: "Failed to fetch trending blogs" });
    }
});

router.get("/most-liked", async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);
        const blogs = await AnalyticsService.getMostLikedBlogs(limit, req.user?._id);
        res.json({ success: true, blogs });
    } catch (error) {
        console.error("Error fetching most liked blogs:", error);
        res.status(500).json({ success: false, message: "Failed to fetch most liked blogs" });
    }
});

router.get("/blog/:blogId", restrictToLoggedInUserOnly, async (req, res) => {
    try {
        const blog = await Blog.findById(req.params.blogId).select("createdBy").lean();
        if (!blog) return res.status(404).json({ success: false, message: "Blog not found" });
        if (blog.createdBy.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: "Not authorized to view these analytics" });
        }
        const analytics = await AnalyticsService.getBlogAnalytics(req.params.blogId);
        if (!analytics) return res.status(404).json({ success: false, message: "No analytics found" });
        res.json({ success: true, analytics });
    } catch (error) {
        console.error("Error fetching blog analytics:", error);
        res.status(500).json({ success: false, message: "Failed to fetch analytics" });
    }
});

router.get("/author/stats", restrictToLoggedInUserOnly, async (req, res) => {
    try {
        const stats = await AnalyticsService.getAuthorAnalytics(req.user._id);
        res.json({ success: true, stats });
    } catch (error) {
        console.error("Error fetching author analytics:", error);
        res.status(500).json({ success: false, message: "Failed to fetch analytics" });
    }
});

module.exports = router;
