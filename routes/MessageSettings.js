const express = require("express");
const router = express.Router();
const User = require("../models/user");

function auth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  next();
}

router.get("/settings", auth, (req, res) => {
  res.render("message-settings", { title: "Message Settings", user: req.user });
});

router.get("/settings/api", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("messageSettings").lean();
    res.json({ messageSettings: user?.messageSettings || {} });
  } catch (error) {
    console.error("Message settings read error:", error);
    res.status(500).json({ error: "Unable to load message settings" });
  }
});

router.patch("/settings/api", auth, async (req, res) => {
  try {
    const allowed = [
      "whoCanMessage", "messageRequests", "readReceipts", "typingIndicator",
      "onlineStatus", "messageNotifications", "messagePreview", "notificationSound",
      "mediaAutoDownload", "allowPhotoMessages", "allowVideoMessages",
      "messageLikes", "groupInvites", "hiddenWords", "autoDelete"
    ];
    const updates = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) updates[`messageSettings.${key}`] = req.body[key];
    }
    const user = await User.findByIdAndUpdate(req.user._id, { $set: updates }, { new: true, runValidators: true })
      .select("messageSettings").lean();
    res.json({ ok: true, messageSettings: user.messageSettings });
  } catch (error) {
    console.error("Message settings update error:", error);
    res.status(500).json({ error: "Unable to save message settings" });
  }
});

module.exports = router;
