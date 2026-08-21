const mongoose = require('mongoose');

const SignupOtpSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    otpHash: { type: String, required: true },
    attempts: { type: Number, default: 0, min: 0, max: 5 },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

// expiresAt is the single source of truth for OTP expiry. The previous
// schema declared the same index twice and also had a second TTL on createdAt.
SignupOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.SignupOtp || mongoose.model('SignupOtp', SignupOtpSchema);
