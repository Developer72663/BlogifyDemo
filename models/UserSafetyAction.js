const mongoose = require('mongoose');

const UserSafetyActionSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true, index: true },
  target: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true, index: true },
  type: { type: String, enum: ['restrict', 'hide_content'], required: true },
}, { timestamps: true });

UserSafetyActionSchema.index({ actor: 1, target: 1, type: 1 }, { unique: true });

module.exports = mongoose.models.UserSafetyAction || mongoose.model('UserSafetyAction', UserSafetyActionSchema);
