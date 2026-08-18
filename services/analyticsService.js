const BlogAnalytics = require("../models/BlogAnalytics");
const Blog = require("../models/Blog");
const User = require("../models/user");

class AnalyticsService {
    static async trackView(blogId, userId, source = "direct") {
        try {
            let analytics = await BlogAnalytics.findOne({ blog: blogId });
            if (!analytics) {
                const blog = await Blog.findById(blogId);
                if (!blog) return;
                analytics = await BlogAnalytics.create({ blog: blogId, author: blog.createdBy });
            }
            analytics.totalViews += 1;
            const validSources = ["direct", "search", "social", "referral"];
            if (validSources.includes(source)) analytics.viewSource[source] += 1;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const dailyViewIndex = analytics.dailyViews.findIndex(dv => new Date(dv.date).getTime() === today.getTime());
            if (dailyViewIndex >= 0) analytics.dailyViews[dailyViewIndex].count += 1;
            else analytics.dailyViews.push({ date: today, count: 1 });
            await analytics.save();
        } catch (error) {
            console.error("Error tracking view:", error);
        }
    }

    static async getBlogAnalytics(blogId) {
        try {
            return await BlogAnalytics.findOne({ blog: blogId })
                .populate("blog", "title viewCount")
                .populate("author", "fullName") || null;
        } catch (error) {
            console.error("Error getting analytics:", error);
            return null;
        }
    }

    static async getAuthorAnalytics(userId) {
        try {
            const analytics = await BlogAnalytics.find({ author: userId }).populate("blog", "title viewCount");
            const totalStats = { totalViews: 0, totalLikes: 0, totalComments: 0, totalBlogs: analytics.length, topBlog: null, maxViews: 0 };
            analytics.forEach(stat => {
                totalStats.totalViews += stat.totalViews;
                totalStats.totalLikes += stat.totalLikes;
                totalStats.totalComments += stat.totalComments;
                if (stat.totalViews > totalStats.maxViews) {
                    totalStats.maxViews = stat.totalViews;
                    totalStats.topBlog = stat.blog;
                }
            });
            return totalStats;
        } catch (error) {
            console.error("Error getting author analytics:", error);
            return null;
        }
    }

    static async getVisibleAnalytics(limit, viewerId, sortField) {
        const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20);
        const rows = await BlogAnalytics.find()
            .sort({ [sortField]: -1 })
            .limit(Math.max(safeLimit * 3, safeLimit))
            .populate("blog", "title slug coverImageURL createdAt createdBy isDeleted status")
            .populate("author", "fullName profileImageURL isPrivate followers");
        const visible = [];
        for (const row of rows) {
            if (!row.blog || row.blog.isDeleted || row.blog.status !== "published" || !row.author) continue;
            if (row.author.isPrivate) {
                const allowed = viewerId && (row.author._id.toString() === viewerId.toString() || row.author.followers.some(id => id.toString() === viewerId.toString()));
                if (!allowed) continue;
            }
            const data = row.toObject();
            if (data.author) delete data.author.followers;
            visible.push(data);
            if (visible.length >= safeLimit) break;
        }
        return visible;
    }

    static async getTrendingBlogs(limit = 5, viewerId) {
        try { return await this.getVisibleAnalytics(limit, viewerId, "totalViews"); }
        catch (error) { console.error("Error getting trending blogs:", error); return []; }
    }

    static async getMostLikedBlogs(limit = 5, viewerId) {
        try { return await this.getVisibleAnalytics(limit, viewerId, "totalLikes"); }
        catch (error) { console.error("Error getting most liked blogs:", error); return []; }
    }
}

module.exports = AnalyticsService;
