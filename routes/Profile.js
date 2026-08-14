const express = require("express");
const router = express.Router();
const Blog = require("../models/Blog");
const User = require("../models/user");
const { restrictToLoggedInUserOnly } = require("../middlewares/authentication");
const cloudinaryUpload = require("../middlewares/CloudinaryUploads");

router.use(restrictToLoggedInUserOnly);

// ====================== GET USER PROFILE (Own Profile) ======================
router.get("/", restrictToLoggedInUserOnly, async (req, res) => {
    try {
        const fullUser = await User.findById(req.user._id)
            .populate("followers", "fullName email profileImageURL bio")
            .populate("following", "fullName email profileImageURL bio");

        if (!fullUser) {
            return res.status(404).send("User not found");
        }

        const blogs = await Blog.find({ createdBy: req.user._id, isDeleted: false })
            .sort({ createdAt: -1 });

        res.render("profile", {
            user: fullUser,
            blogs: blogs || [],
            isOwner: true,
            isMutualFollow: false,
            canViewFullProfile: true
        });
    } catch (error) {
        console.error("🚨 Profile Route Error:", error.message);
        res.status(500).send("Internal Server Error");
    }
});

// ====================== GET SETTINGS PAGE ======================
router.get("/settings", async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .populate("followers", "fullName profileImageURL")
            .populate("following", "fullName profileImageURL");

        res.render("settings", {
            user: user,
            success: null,
            error: null
        });
    } catch (error) {
        console.error("Settings Page Error:", error);
        res.status(500).render("error", { error: error.message });
    }
});

// ====================== UPDATE PROFILE ======================
router.put("/update", async (req, res) => {
    try {
        const { fullName, bio, website, location } = req.body;

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Update user fields
        user.fullName = fullName || user.fullName;
        user.bio = bio || user.bio;
        user.website = website || user.website;
        user.location = location || user.location;

        // Save user
        await user.save();

        res.json({
            success: true,
            message: "Profile updated successfully",
            user: user
        });
    } catch (error) {
        console.error("Update Profile Error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to update profile"
        });
    }
});

// ====================== UPLOAD PROFILE IMAGE ======================
router.post("/upload-image", cloudinaryUpload.single("profileImage"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No image uploaded"
            });
        }

        const user = await User.findById(req.user._id);
        user.profileImageURL = req.file.path;
        await user.save();

        res.json({
            success: true,
            message: "Profile image updated",
            imageURL: req.file.path
        });
    } catch (error) {
        console.error("Upload Image Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to upload image"
        });
    }
});

// ====================== CHANGE PASSWORD ======================
router.post("/change-password", async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: "Passwords do not match"
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "New password must be at least 6 characters"
            });
        }

        const user = await User.findById(req.user._id);

        if (user.googleId && !user.password) {
            return res.status(400).json({
                success: false,
                message: "This account uses Google Sign-In. Cannot change password."
            });
        }

        const { createHmac } = require("crypto");
        const currentHash = createHmac("sha256", user.salt)
            .update(currentPassword)
            .digest("hex");

        if (user.password !== currentHash) {
            return res.status(401).json({
                success: false,
                message: "Current password is incorrect"
            });
        }

        user.password = newPassword;
        await user.save();

        res.json({
            success: true,
            message: "Password changed successfully"
        });
    } catch (error) {
        console.error("Change Password Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to change password"
        });
    }
});

// ====================== UPDATE ACCOUNT PRIVACY ======================
router.put("/privacy", async (req, res) => {
    try {
        const { isPrivate } = req.body;

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        user.isPrivate = isPrivate;
        await user.save();

        res.json({
            success: true,
            message: `Account is now ${isPrivate ? 'private' : 'public'}`,
            user: user
        });
    } catch (error) {
        console.error("Privacy Update Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to update privacy settings"
        });
    }
});

// ====================== UPDATE NOTIFICATION SETTINGS ======================
router.put("/notifications", async (req, res) => {
    try {
        const { emailOnComment, emailOnNewFollower, emailDigest } = req.body;

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        user.notificationSettings = {
            emailOnComment: emailOnComment || false,
            emailOnNewFollower: emailOnNewFollower || false,
            emailDigest: emailDigest || false
        };
        await user.save();

        res.json({
            success: true,
            message: "Notification settings updated",
            user: user
        });
    } catch (error) {
        console.error("Notification Settings Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to update notification settings"
        });
    }
});

// ====================== DELETE ACCOUNT ======================
router.delete("/delete-account", async (req, res) => {
    try {
        const { password } = req.body;
        const userId = req.user._id;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Verify password before deletion
        if (!user.googleId && user.password) {
            const { createHmac } = require("crypto");
            const passwordHash = createHmac("sha256", user.salt)
                .update(password)
                .digest("hex");

            if (user.password !== passwordHash) {
                return res.status(401).json({
                    success: false,
                    message: "Incorrect password. Account deletion cancelled."
                });
            }
        }

        // Delete all user's blogs
        await Blog.deleteMany({ createdBy: userId });

        // Delete user
        await User.findByIdAndDelete(userId);

        // Clear auth cookie
        res.clearCookie("token");

        res.json({
            success: true,
            message: "Account deleted successfully"
        });
    } catch (error) {
        console.error("Delete Account Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to delete account"
        });
    }
});

module.exports = router;
