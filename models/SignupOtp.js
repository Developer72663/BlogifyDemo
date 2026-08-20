const mongoose = require('mongoose');

const SignupOtpSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    otpHash: { type: String, required: true },
    attempts: { type: Number, default: 0, min: 0, max: 5 },
    expiresAt: { type: Date, required: true, index: true },
    createdAt: { type: Date, default: Date.now, expires: 600 }
}, { versionKey: false });

SignupOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.SignupOtp || mongoose.model('SignupOtp', SignupOtpSchema);
