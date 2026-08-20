const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const { createHmac, timingSafeEqual } = require("crypto");
const bcrypt = require("bcryptjs");
const { creatTokenForUser } = require("../services/authentication");

const parsedRounds = Number.parseInt(process.env.BCRYPT_ROUNDS || "12", 10);
const BCRYPT_ROUNDS = Number.isFinite(parsedRounds) ? Math.min(15, Math.max(12, parsedRounds)) : 12;

const UserSchema = new Schema({
    fullName: { type: String, required: true, trim: true }, email: { type: String, required: true, unique: true, lowercase: true, trim: true }, salt: { type: String }, password: { type: String }, passwordHashVersion: { type: String, enum: ["legacy-hmac-sha256", "bcrypt"], default: "bcrypt" }, googleId: { type: String, unique: true, sparse: true }, profileImageURL: { type: String, default: "/imgs/default.png" }, bio: { type: String, default: "", maxlength: 500 }, website: { type: String, default: "" }, location: { type: String, default: "", maxlength: 120 }, role: { type: String, enum: ["USER", "ADMIN"], default: "USER" }, theme: { type: String, enum: ["light", "dark", "system"], default: "system" }, isPrivate: { type: Boolean, default: false }, isDeactivated: { type: Boolean, default: false },
    followers: [{ type: Schema.Types.ObjectId, ref: "user" }], following: [{ type: Schema.Types.ObjectId, ref: "user" }], blockedUsers: [{ type: Schema.Types.ObjectId, ref: "user" }],
    notificationSettings: { emailOnComment: { type: Boolean, default: true }, emailOnNewFollower: { type: Boolean, default: true }, emailOnFollowRequest: { type: Boolean, default: true }, emailOnRequestAccepted: { type: Boolean, default: true }, emailOnLike: { type: Boolean, default: true }, emailOnMention: { type: Boolean, default: true }, emailDigest: { type: Boolean, default: true }, pushEnabled: { type: Boolean, default: false }, pushOnMessage: { type: Boolean, default: true }, pushOnComment: { type: Boolean, default: true }, pushOnReply: { type: Boolean, default: true }, pushOnLike: { type: Boolean, default: true }, pushOnFollow: { type: Boolean, default: true }, pushOnFollowRequest: { type: Boolean, default: true }, pushOnMention: { type: Boolean, default: true }, pushOnBlogPost: { type: Boolean, default: true } },
    messageSettings: { whoCanMessage: { type: String, enum: ["everyone", "followers", "no_one"], default: "everyone" }, messageRequests: { type: Boolean, default: true }, readReceipts: { type: Boolean, default: true }, typingIndicator: { type: Boolean, default: true }, onlineStatus: { type: String, enum: ["everyone", "followers", "off"], default: "everyone" }, messageNotifications: { type: Boolean, default: true }, messagePreview: { type: Boolean, default: true }, notificationSound: { type: Boolean, default: true }, mediaAutoDownload: { type: String, enum: ["wifi_mobile", "wifi_only", "never"], default: "wifi_mobile" }, allowPhotoMessages: { type: Boolean, default: true }, allowVideoMessages: { type: Boolean, default: true }, messageLikes: { type: Boolean, default: true }, groupInvites: { type: String, enum: ["everyone", "followers", "no_one"], default: "everyone" }, hiddenWords: { type: Boolean, default: false }, autoDelete: { type: String, enum: ["never", "24h", "7d", "30d"], default: "never" } },
    blogSettings: { defaultVisibility: { type: String, enum: ["public", "followers"], default: "public" }, allowComments: { type: Boolean, default: true }, allowLikes: { type: Boolean, default: true }, showViewCount: { type: Boolean, default: true }, autoDrafts: { type: Boolean, default: true }, defaultCategory: { type: String, default: "" }, defaultTags: { type: [String], default: [] } },
    commentSettings: { allowComments: { type: Boolean, default: true }, moderateComments: { type: Boolean, default: false }, notifyReplies: { type: Boolean, default: true } }, interfaceSettings: { compactLayout: { type: Boolean, default: false }, reduceAnimations: { type: Boolean, default: false } }
}, { timestamps: true });

UserSchema.index({ email: 1 }); UserSchema.index({ followers: 1 }); UserSchema.index({ following: 1 });
UserSchema.virtual("followerCount").get(function() { return this.followers ? this.followers.length : 0; });
UserSchema.virtual("followingCount").get(function() { return this.following ? this.following.length : 0; });
UserSchema.pre("save", async function (next) { if (this.googleId || !this.password || !this.isModified("password")) return next(); try { this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS); this.passwordHashVersion = "bcrypt"; this.salt = undefined; next(); } catch (error) { next(error); } });

function legacyPasswordMatches(password, user) { if (!user.salt || !user.password) return false; const provided = createHmac("sha256", user.salt).update(password).digest("hex"); const a = Buffer.from(provided, "utf8"), b = Buffer.from(user.password, "utf8"); return a.length === b.length && timingSafeEqual(a, b); }
UserSchema.static("verifyPassword", async function(user, password) { if (!user?.password || user.isDeactivated) return false; if (user.passwordHashVersion === "bcrypt" || String(user.password).startsWith("$2")) return bcrypt.compare(password, user.password); const valid = legacyPasswordMatches(password, user); if (valid) { user.password = password; await user.save(); } return valid; });
UserSchema.static("matchPassword", async function (email, password) { const user = await this.findOne({ email: email.toLowerCase() }); if (!user) throw new Error("User not found"); if (user.isDeactivated) throw new Error("Account is deactivated"); if (!user.password) throw new Error("This account uses Google Sign-In"); if (!(await this.verifyPassword(user, password))) throw new Error("Incorrect Password"); return creatTokenForUser(user); });

UserSchema.static("findOrCreateGoogleUser", async function (profile) {
    const googleId = String(profile?.id || "").trim(), email = String(profile?.emails?.[0]?.value || "").trim().toLowerCase(); if (!googleId) throw new Error("Google account ID is missing."); if (!email) throw new Error("Google account email is missing.");
    const displayName = String(profile?.displayName || "Google User").trim() || "Google User", photo = profile?.photos?.[0]?.value ? String(profile.photos[0].value).trim() : "";
    let user = await this.findOne({ googleId });
    if (user) { if (user.isDeactivated) throw new Error("Account is deactivated"); if (photo && user.profileImageURL !== photo) { user.profileImageURL = photo; await user.save(); } return user; }
    user = await this.findOne({ email });
    if (user) { if (user.isDeactivated) throw new Error("Account is deactivated"); if (user.googleId && user.googleId !== googleId) throw new Error("This email is already linked to another Google account."); user.googleId = googleId; if (photo) user.profileImageURL = photo; await user.save(); return user; }
    try { return await this.create({ fullName: displayName, email, googleId, profileImageURL: photo || "/imgs/default.png" }); } catch (error) { if (error?.code === 11000) { const existing = await this.findOne({ $or: [{ googleId }, { email }] }); if (existing) { if (existing.isDeactivated) throw new Error("Account is deactivated"); if (!existing.googleId) { existing.googleId = googleId; if (photo) existing.profileImageURL = photo; await existing.save(); } return existing; } } throw error; }
});

UserSchema.methods.followUser = async function(userId) { if (!this.following.includes(userId)) { this.following.push(userId); await this.save(); } };
UserSchema.methods.unfollowUser = async function(userId) { this.following = this.following.filter(id => id.toString() !== userId.toString()); await this.save(); };
UserSchema.methods.isFollowing = function(userId) { return this.following.some(id => id.toString() === userId.toString()); };
UserSchema.methods.addFollower = async function(userId) { if (!this.followers.includes(userId)) { this.followers.push(userId); await this.save(); } };
UserSchema.methods.removeFollower = async function(userId) { this.followers = this.followers.filter(id => id.toString() !== userId.toString()); await this.save(); };

const User = mongoose.models.user || model("user", UserSchema); module.exports = User;
