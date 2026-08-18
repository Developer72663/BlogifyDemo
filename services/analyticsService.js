const BlogAnalytics = require("../models/BlogAnalytics");
const Blog = require("../models/Blog");
const User = require("../models/user");
const Comment = require("../models/Comment");

const safePercent = (value) => Number.isFinite(value) ? Number(value.toFixed(2)) : 0;

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
            const validSources = ["direct", "search", "social", "referral", "home", "profile", "notification"];
            if (validSources.includes(source)) {
                if (!analytics.viewSource) analytics.viewSource = {};
                if (analytics.viewSource[source] == null) analytics.viewSource[source] = 0;
                analytics.viewSource[source] += 1;
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const dailyViewIndex = analytics.dailyViews.findIndex(dv => new Date(dv.date).getTime() === today.getTime());
            if (dailyViewIndex >= 0) analytics.dailyViews[dailyViewIndex].count += 1;
            else analytics.dailyViews.push({ date: today, count: 1 });
            // Keep the chart compact while preserving roughly one year of history.
            if (analytics.dailyViews.length > 366) analytics.dailyViews = analytics.dailyViews.slice(-366);
            await analytics.save();
        } catch (error) {
            console.error("Error tracking view:", error);
        }
    }

    static async getBlogAnalytics(blogId) {
        try {
            const analytics = await BlogAnalytics.findOne({ blog: blogId })
                .populate("blog", "title slug coverImageURL createdAt createdBy viewCount likes")
                .populate("author", "fullName profileImageURL") || null;
            if (!analytics) return null;

            const comments = await Comment.countDocuments({ blog: blogId, isDeleted: false, isApproved: true });
            const likes = analytics.blog?.likes?.length || analytics.totalLikes || 0;
            const views = analytics.totalViews || analytics.blog?.viewCount || 0;
            const engagementRate = views ? safePercent(((likes + comments) / views) * 100) : 0;

            const data = analytics.toObject();
            data.totalLikes = likes;
            data.totalComments = comments;
            data.engagementRate = engagementRate;
            data.performanceScore = this.calculatePerformanceScore(views, likes, comments, analytics.dailyViews || []);
            return data;
        } catch (error) {
            console.error("Error getting analytics:", error);
            return null;
        }
    }

    static calculatePerformanceScore(views, likes, comments, dailyViews = []) {
        if (!views) return 0;
        const engagement = Math.min(50, ((likes + comments) / views) * 500);
        const recent = dailyViews.filter(d => Date.now() - new Date(d.date).getTime() <= 7 * 86400000).reduce((sum, d) => sum + (d.count || 0), 0);
        const growth = Math.min(30, recent ? Math.log10(recent + 1) * 10 : 0);
        return Math.min(100, Math.round(engagement + growth + Math.min(20, Math.log10(views + 1) * 5)));
    }

    static async getAuthorAnalytics(userId) {
        try {
            const analytics = await BlogAnalytics.find({ author: userId }).populate("blog", "title slug coverImageURL viewCount likes createdAt isDeleted status");
            const published = analytics.filter(stat => stat.blog && !stat.blog.isDeleted && stat.blog.status === "published");
            const blogIds = published.map(stat => stat.blog._id);
            const commentCounts = blogIds.length ? await Comment.aggregate([
                { $match: { blog: { $in: blogIds }, isDeleted: false, isApproved: true } },
                { $group: { _id: "$blog", count: { $sum: 1 } } }
            ]) : [];
            const commentMap = new Map(commentCounts.map(c => [c._id.toString(), c.count]));

            const rows = published.map(stat => {
                const views = stat.totalViews || stat.blog.viewCount || 0;
                const likes = stat.blog.likes?.length || stat.totalLikes || 0;
                const comments = commentMap.get(stat.blog._id.toString()) || 0;
                return {
                    blog: stat.blog,
                    views,
                    likes,
                    comments,
                    engagementRate: views ? safePercent(((likes + comments) / views) * 100) : 0,
                    performanceScore: this.calculatePerformanceScore(views, likes, comments, stat.dailyViews || [])
                };
            });

            const totalViews = rows.reduce((n, r) => n + r.views, 0);
            const totalLikes = rows.reduce((n, r) => n + r.likes, 0);
            const totalComments = rows.reduce((n, r) => n + r.comments, 0);
            const topBlog = [...rows].sort((a, b) => b.views - a.views)[0] || null;
            const mostEngaging = [...rows].sort((a, b) => b.engagementRate - a.engagementRate)[0] || null;
            const growingBlog = [...rows].sort((a, b) => b.performanceScore - a.performanceScore)[0] || null;

            const traffic = { home: 0, profile: 0, notification: 0, direct: 0, search: 0, social: 0, referral: 0 };
            published.forEach(stat => {
                Object.keys(traffic).forEach(key => traffic[key] += stat.viewSource?.[key] || 0);
            });

            return {
                totalViews,
                totalLikes,
                totalComments,
                totalBlogs: rows.length,
                engagementRate: totalViews ? safePercent(((totalLikes + totalComments) / totalViews) * 100) : 0,
                topBlog,
                mostEngaging,
                growingBlog,
                blogs: rows.sort((a, b) => b.views - a.views),
                trafficSources: traffic
            };
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
