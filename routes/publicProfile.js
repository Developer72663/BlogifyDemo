const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Blog = require("../models/Blog");
const User = require("../models/user");

router.get("/:userId", async (req, res) => {
    try {
        const { userId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(404).render("404", { user: req.user || null });
        }

        const profileUser = await User.findById(userId)
            .populate("followers", "fullName profileImageURL email")
            .populate("following", "fullName profileImageURL email")
            .lean();

        if (!profileUser) {
            return res.status(404).render("404", { user: req.user || null });
        }

        // Determine relationship status
        let isOwner = false;
        let isFollowing = false;
        let isMutualFollow = false;
        let followButtonText = "Follow";

        if (req.user) {
            isOwner = req.user._id.toString() === userId.toString();
            
            const currentUser = await User.findById(req.user._id).lean();
            isFollowing = currentUser.following.some(id => id.toString() === userId);

            const profileFollowsMe = profileUser.followers.some(
                f => f._id.toString() === req.user._id.toString()
            );
            
            isMutualFollow = isFollowing && profileFollowsMe;
            
            // Set follow button text
            if (isFollowing) {
                followButtonText = "Following";
            }
        }

        // ====================== PRIVACY LOGIC ======================
        // Show full profile if:
        // 1. Viewing own profile (isOwner)
        // 2. Mutual follow (both following each other)
        const canViewFullProfile = isOwner || isMutualFollow;

        let blogs = [];
        let blogCount = 0;

        if (canViewFullProfile) {
            // Show all published blogs
            blogs = await Blog.find({
                createdBy: userId,
                isDeleted: false,
                status: "published"
            })
                .sort({ createdAt: -1 })
                .populate("createdBy", "fullName profileImageURL")
                .lean();
            blogCount = blogs.length;
        } else {
            // Only show blog count (don't show actual blogs)
            blogCount = await Blog.countDocuments({
                createdBy: userId,
                isDeleted: false,
                status: "published"
            });
        }

        // Prepare followers/following lists based on privacy
        let visibleFollowers = [];
        let visibleFollowing = [];

        if (canViewFullProfile) {
            visibleFollowers = profileUser.followers || [];
            visibleFollowing = profileUser.following || [];
        }
        // else: keep empty arrays

        res.render("publicProfile", {
            user: req.user || null,
            profileUser,
            blogs: canViewFullProfile ? blogs : [],
            stats: {
                blogCount: blogCount,
                followerCount: profileUser.followers ? profileUser.followers.length : 0,
                followingCount: profileUser.following ? profileUser.following.length : 0
            },
            isOwner,
            isFollowing,
            isMutualFollow,
            canViewFullProfile, // Pass this to template
            canViewFollowers: canViewFullProfile,
            canViewFollowing: canViewFullProfile,
            visibleFollowers: canViewFullProfile ? profileUser.followers : [],
            visibleFollowing: canViewFullProfile ? profileUser.following : [],
            followButtonText
        });

    } catch (error) {
        console.error("Public Profile Error:", error);
        res.status(500).render("error", {
            user: req.user || null,
            error: "Failed to load profile"
        });
    }
});

module.exports = router;
