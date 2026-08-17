const express = require("express");
const router = express.Router();
const Blog = require("../models/Blog");
const User = require("../models/user");
const { restrictToLoggedInUserOnly } = require("../middlewares/authentication");
const cloudinaryUpload = require("../middlewares/CloudinaryUploads");

router.use(restrictToLoggedInUserOnly);

router.get("/", async (req, res) => {
    try {
        const fullUser = await User.findById(req.user._id)
            .populate("followers", "fullName email profileImageURL bio")
            .populate("following", "fullName email profileImageURL bio");

        if (!fullUser) return res.status(404).send("User not found");

        const blogs = await Blog.find({ createdBy: req.user._id, isDeleted: false })
            .sort({ createdAt: -1 });

        res.render("profile", { user: fullUser, blogs: blogs || [] });
    } catch (error) {
        console.error("🚨 Profile Route Error:", error.message);
        res.status(500).send("Internal Server Error");
    }
});

// ====================== SETTINGS PAGE ======================
router.get("/settings", async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .populate("followers", "fullName profileImageURL")
            .populate("following", "fullName profileImageURL")
            .lean();

        if (!user) return res.status(404).send("User not found");

        res.render("settings", { user });
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

        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        if (!fullName || fullName.trim().length < 2) {
            return res.status(400).json({ success: false, message: "Full name must contain at least 2 characters" });
        }

        user.fullName = fullName.trim();
        user.bio = (bio || "").trim().slice(0, 500);
        user.website = (website || "").trim();
        user.location = (location || "").trim().slice(0, 120);
        await user.save();

        res.json({
            success: true,
            message: "Profile updated successfully",
            user: {
                fullName: user.fullName,
                bio: user.bio,
                website: user.website,
                location: user.location,
                profileImageURL: user.profileImageURL
            }
        });
    } catch (error) {
        console.error("Update Profile Error:", error);
        res.status(500).json({ success: false, message: error.message || "Failed to update profile" });
    }
});

// ====================== SETTINGS: THEME ======================
router.patch("/settings/theme", async (req, res) => {
    try {
        const { theme } = req.body;
        if (!["light", "dark", "system"].includes(theme)) {
            return res.status(400).json({ success: false, message: "Invalid theme" });
        }

        await User.findByIdAndUpdate(req.user._id, { theme }, { runValidators: true });
        res.json({ success: true, message: "Appearance updated", theme });
    } catch (error) {
        console.error("Theme Settings Error:", error);
        res.status(500).json({ success: false, message: "Failed to update appearance" });
    }
});

// ====================== SETTINGS: PRIVACY ======================
router.patch("/settings/privacy", async (req, res) => {
    try {
        const isPrivate = req.body.isPrivate === true || req.body.isPrivate === "true";
        await User.findByIdAndUpdate(req.user._id, { isPrivate });
        res.json({ success: true, message: "Privacy settings updated", isPrivate });
    } catch (error) {
        console.error("Privacy Settings Error:", error);
        res.status(500).json({ success: false, message: "Failed to update privacy" });
    }
});

// ====================== SETTINGS: NOTIFICATIONS ======================
router.patch("/settings/notifications", async (req, res) => {
    try {
        const allowed = ["emailOnComment", "emailOnNewFollower", "emailDigest"];
        const update = {};

        allowed.forEach(key => {
            if (typeof req.body[key] === "boolean") {
                update[`notificationSettings.${key}`] = req.body[key];
            }
        });

        if (!Object.keys(update).length) {
            return res.status(400).json({ success: false, message: "No notification setting supplied" });
        }

        await User.findByIdAndUpdate(req.user._id, { $set: update });
        res.json({ success: true, message: "Notification preferences saved" });
    } catch (error) {
        console.error("Notification Settings Error:", error);
        res.status(500).json({ success: false, message: "Failed to update notifications" });
    }
});

// ====================== UPLOAD PROFILE IMAGE ======================
router.post("/upload-image", cloudinaryUpload.single("profileImage"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No image uploaded" });

        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        user.profileImageURL = req.file.path;
        await user.save();
        res.json({ success: true, message: "Profile image updated", imageURL: req.file.path });
    } catch (error) {
        console.error("Upload Image Error:", error);
        res.status(500).json({ success: false, message: "Failed to upload image" });
    }
});

// ====================== CHANGE PASSWORD ======================
router.post("/change-password", async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Current and new passwords are required" });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
        }

        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        if (user.googleId && !user.password) {
            return res.status(400).json({ success: false, message: "This account uses Google Sign-In. Cannot change password." });
        }

        const { createHmac } = require("crypto");
        const currentHash = createHmac("sha256", user.salt).update(currentPassword).digest("hex");
        if (user.password !== currentHash) {
            return res.status(401).json({ success: false, message: "Current password is incorrect" });
        }

        user.password = newPassword;
        await user.save();
        res.json({ success: true, message: "Password changed successfully" });
    } catch (error) {
        console.error("Change Password Error:", error);
        res.status(500).json({ success: false, message: "Failed to change password" });
    }
});

// ====================== DELETE ACCOUNT ======================
router.delete("/delete-account", async (req, res) => {
    try {
        const userId = req.user._id;
        await Blog.deleteMany({ createdBy: userId });
        await User.findByIdAndDelete(userId);
        res.clearCookie("token");
        res.json({ success: true, message: "Account deleted successfully" });
    } catch (error) {
        console.error("Delete Account Error:", error);
        res.status(500).json({ success: false, message: "Failed to delete account" });
    }
});

// ====================== GET EDIT PROFILE PAGE ======================
router.get("/edit", async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .populate("followers", "fullName profileImageURL")
            .populate("following", "fullName profileImageURL");
        res.render("editProfile", { user, success: null, error: null });
    } catch (error) {
        console.error("Edit Profile Page Error:", error);
        res.status(500).render("error", { error: error.message });
    }
});

module.exports = router;
