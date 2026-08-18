const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true, index: true },
  reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true, index: true },
  reason: { type: String, enum: ['spam', 'harassment', 'hate', 'scam', 'inappropriate', 'impersonation', 'other'], required: true },
  description: { type: String, maxlength: 1000, default: '' },
  status: { type: String, enum: ['open', 'reviewing', 'resolved', 'dismissed'], default: 'open', index: true }
}, { timestamps: true });

module.exports = mongoose.models.Report || mongoose.model('Report', ReportSchema);
