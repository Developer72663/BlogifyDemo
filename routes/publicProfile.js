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

        const blogCount = await Blog.countDocuments({ 
            createdBy: userId, 
            isDeleted: false,
            status: "published" 
        });

        const blogs = await Blog.find({ 
            createdBy: userId, 
            isDeleted: false,
            status: "published" 
        })
            .sort({ createdAt: -1 })
            .populate("createdBy", "fullName profileImageURL")
            .lean();

        let showFollowersList = false;
        let showFollowingList = false;
        let isFollowing = false;
        let isMutualFollow = false;
        let isOwner = false;

        if (req.user) {
            isOwner = req.user._id.toString() === userId.toString();
            const currentUser = await User.findById(req.user._id).lean();
            isFollowing = currentUser.following.some(id => id.toString() === userId);

            const profileFollowsMe = profileUser.followers.some(
                f => f._id.toString() === req.user._id.toString()
            );
            isMutualFollow = isFollowing && profileFollowsMe;

            showFollowersList = isOwner || isMutualFollow;
            showFollowingList = isOwner || isMutualFollow;
        }

        res.render("publicProfile", {
            user: req.user || null,
            profileUser,
            blogs,
            stats: {
                blogCount,
                followerCount: profileUser.followers.length,
                followingCount: profileUser.following.length
            },
            isOwner,
            isFollowing,
            isMutualFollow,
            showFollowersList,
            showFollowingList,
            visibleFollowers: showFollowersList ? profileUser.followers : [],
            visibleFollowing: showFollowingList ? profileUser.following : []
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
