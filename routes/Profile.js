const express = require("express");
const router = express.Router();
const Blog = require("../models/Blog");
const User = require("../models/user");
const { restrictToLoggedInUserOnly } = require("../middlewares/authentication");
const cloudinaryUpload = require("../middlewares/CloudinaryUploads");

router.use(restrictToLoggedInUserOnly);

// ====================== GET USER PROFILE ======================
// ====================== VIEW PROFILE ======================
router.get("/", restrictToLoggedInUserOnly, async (req, res) => {
    try {
        // This is the fix: actively populating followers and following data fields
        const fullUser = await User.findById(req.user._id)
            .populate("followers", "fullName email profileImageURL bio")
            .populate("following", "fullName email profileImageURL bio");

        if (!fullUser) {
            return res.status(404).send("User not found");
        }

        // Fetch blogs authored by this specific user
        const blogs = await Blog.find({ createdBy: req.user._id, isDeleted: false })
            .sort({ createdAt: -1 });

        // Render profile view with the fully populated data structures
        res.render("profile", {
            user: fullUser,
            blogs: blogs || []
        });
    } catch (error) {
        console.error("🚨 Profile Route Error:", error.message);
        res.status(500).send("Internal Server Error");
    }
});
// ====================== GET EDIT PROFILE PAGE ======================
router.get("/edit", async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .populate("followers", "fullName profileImageURL")
            .populate("following", "fullName profileImageURL");

        res.render("editProfile", {
            user: user,
            success: null,
            error: null
        });
    } catch (error) {
        console.error("Edit Profile Page Error:", error);
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
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ 
                success: false, 
                message: "Current and new passwords are required" 
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: "New password must be at least 6 characters" 
            });
        }

        // Verify current password
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

        // Update password (will be hashed by pre-save hook)
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

// ====================== DELETE ACCOUNT ======================
router.delete("/delete-account", async (req, res) => {
    try {
        const userId = req.user._id;

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
