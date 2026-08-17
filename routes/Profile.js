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
        const blogs = await Blog.find({ createdBy: req.user._id, isDeleted: false }).sort({ createdAt: -1 });
        res.render("profile", { user: fullUser, blogs: blogs || [] });
    } catch (error) {
        console.error("🚨 Profile Route Error:", error.message);
        res.status(500).send("Internal Server Error");
    }
});

router.get("/settings", async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).send("User not found");
        res.render("settings", { user, activeSection: req.query.section || "profile" });
    } catch (error) {
        console.error("Settings Page Error:", error);
        res.status(500).render("error", { error: error.message });
    }
});

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

router.put("/update", async (req, res) => {
    try {
        const { fullName, bio, website, location } = req.body;
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        if (typeof fullName === "string" && fullName.trim()) user.fullName = fullName.trim();
        if (typeof bio === "string") user.bio = bio.trim().slice(0, 500);
        if (typeof website === "string") user.website = website.trim();
        if (typeof location === "string") user.location = location.trim().slice(0, 120);
        await user.save();
        res.json({ success: true, message: "Profile updated successfully", user });
    } catch (error) {
        console.error("Update Profile Error:", error);
        res.status(500).json({ success: false, message: error.message || "Failed to update profile" });
    }
});

// Avatar upload is wrapped manually so Multer/Cloudinary errors are always returned as JSON.
router.post("/upload-image", (req, res) => {
    cloudinaryUpload.single("profileImage")(req, res, async (uploadError) => {
        if (uploadError) {
            console.error("Upload Image Error:", uploadError);
            if (uploadError.code === "LIMIT_FILE_SIZE") {
                return res.status(413).json({ success: false, message: "Profile photo must be 10MB or smaller" });
            }
            if (uploadError.code === "INVALID_IMAGE_TYPE" || uploadError.code === "LIMIT_UNEXPECTED_FILE") {
                return res.status(400).json({ success: false, message: "Please choose a valid image file (JPG, JPEG, PNG, GIF, WEBP, BMP, TIFF or AVIF)" });
            }
            return res.status(500).json({ success: false, message: uploadError.message || "Unable to upload profile photo" });
        }

        try {
            if (!req.file || !req.file.path) {
                return res.status(400).json({ success: false, message: "Please select a profile photo" });
            }

            const user = await User.findById(req.user._id);
            if (!user) return res.status(404).json({ success: false, message: "User not found" });

            user.profileImageURL = req.file.path;
            await user.save();

            return res.json({
                success: true,
                message: "Profile photo updated successfully",
                imageURL: req.file.path,
            });
        } catch (error) {
            console.error("Save Profile Image Error:", error);
            return res.status(500).json({ success: false, message: "Profile photo uploaded but could not be saved" });
        }
    });
});

router.patch("/settings/theme", async (req, res) => {
    try {
        const theme = String(req.body.theme || "").toLowerCase();
        if (!["light", "dark", "system"].includes(theme)) return res.status(400).json({ success: false, message: "Invalid theme" });
        const user = await User.findByIdAndUpdate(req.user._id, { theme }, { new: true });
        res.json({ success: true, theme: user.theme });
    } catch (error) { res.status(500).json({ success: false, message: "Unable to save theme" }); }
});

router.patch("/settings/privacy", async (req, res) => {
    try {
        const isPrivate = req.body.isPrivate === true || req.body.isPrivate === "true";
        const user = await User.findByIdAndUpdate(req.user._id, { isPrivate }, { new: true });
        res.json({ success: true, isPrivate: user.isPrivate });
    } catch (error) { res.status(500).json({ success: false, message: "Unable to save privacy setting" }); }
});

router.patch("/settings/notifications", async (req, res) => {
    try {
        const allowed = ["emailOnComment", "emailOnNewFollower", "emailDigest"];
        const update = {};
        for (const key of allowed) if (typeof req.body[key] === "boolean") update[`notificationSettings.${key}`] = req.body[key];
        if (!Object.keys(update).length) return res.status(400).json({ success: false, message: "No notification setting supplied" });
        const user = await User.findByIdAndUpdate(req.user._id, { $set: update }, { new: true });
        res.json({ success: true, notificationSettings: user.notificationSettings });
    } catch (error) { res.status(500).json({ success: false, message: "Unable to save notification settings" }); }
});

router.post("/change-password", async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.status(400).json({ success: false, message: "Current and new passwords are required" });
        if (newPassword.length < 6) return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
        const user = await User.findById(req.user._id);
        if (user.googleId && !user.password) return res.status(400).json({ success: false, message: "This account uses Google Sign-In. Cannot change password." });
        const { createHmac } = require("crypto");
        const currentHash = createHmac("sha256", user.salt).update(currentPassword).digest("hex");
        if (user.password !== currentHash) return res.status(401).json({ success: false, message: "Current password is incorrect" });
        user.password = newPassword;
        await user.save();
        res.json({ success: true, message: "Password changed successfully" });
    } catch (error) {
        console.error("Change Password Error:", error);
        res.status(500).json({ success: false, message: "Failed to change password" });
    }
});

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

module.exports = router;
