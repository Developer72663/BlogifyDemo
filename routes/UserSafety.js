const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const User = require('../models/user');
const Report = require('../models/Report');
const UserSafetyAction = require('../models/UserSafetyAction');
const Conversation = require('../models/Conversation');
const Blog = require('../models/Blog');
const Comment = require('../models/Comment');
const Notification = require('../models/Notification');

function auth(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });
  next();
}
function validId(id) { return mongoose.Types.ObjectId.isValid(id); }

router.post('/:userId/block', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!validId(userId) || req.user._id.toString() === userId) return res.status(400).json({ success:false, message:'Invalid user' });
    const target = await User.findById(userId);
    if (!target) return res.status(404).json({ success:false, message:'User not found' });
    const me = await User.findById(req.user._id);
    if (!me.blockedUsers.some(id => id.toString() === userId)) me.blockedUsers.push(target._id);
    me.following = me.following.filter(id => id.toString() !== userId);
    me.followers = me.followers.filter(id => id.toString() !== userId);
    target.following = target.following.filter(id => id.toString() !== req.user._id.toString());
    target.followers = target.followers.filter(id => id.toString() !== req.user._id.toString());
    await Promise.all([
      me.save(),
      target.save(),
      Conversation.deleteMany({ participants: { $all: [req.user._id, target._id], $size: 2 } })
    ]);
    res.json({ success:true, blocked:true });
  } catch (e) { console.error('Block error', e); res.status(500).json({ success:false, message:'Unable to block user' }); }
});

router.delete('/:userId/block', auth, async (req, res) => {
  try {
    if (!validId(req.params.userId) || req.user._id.toString() === req.params.userId) return res.status(400).json({ success:false, message:'Invalid user' });
    const me = await User.findById(req.user._id);
    if (!me) return res.status(404).json({ success:false, message:'User not found' });
    me.blockedUsers = me.blockedUsers.filter(id => id.toString() !== req.params.userId);
    await me.save();
    res.json({ success:true, blocked:false });
  } catch (e) { res.status(500).json({ success:false, message:'Unable to unblock user' }); }
});

router.get('/blocked', auth, async (req, res) => {
  try {
    const me = await User.findById(req.user._id).populate('blockedUsers', 'fullName profileImageURL');
    res.json({ success:true, users:me?.blockedUsers || [] });
  } catch (e) { res.status(500).json({ success:false, message:'Unable to load blocked users' }); }
});

router.post('/:userId/restrict', auth, async (req, res) => {
  try {
    if (!validId(req.params.userId) || req.user._id.toString() === req.params.userId) return res.status(400).json({ success:false, message:'Invalid user' });
    const target = await User.findById(req.params.userId).select('_id');
    if (!target) return res.status(404).json({ success:false, message:'User not found' });
    await UserSafetyAction.findOneAndUpdate({ actor:req.user._id, target:target._id, type:'restrict' }, { actor:req.user._id, target:target._id, type:'restrict' }, { upsert:true, new:true });
    res.json({ success:true, restricted:true });
  } catch(e) { res.status(500).json({ success:false, message:'Unable to restrict user' }); }
});

router.delete('/:userId/restrict', auth, async (req,res) => {
  try {
    if (!validId(req.params.userId)) return res.status(400).json({ success:false, message:'Invalid user' });
    await UserSafetyAction.deleteOne({ actor:req.user._id, target:req.params.userId, type:'restrict' });
    res.json({ success:true, restricted:false });
  } catch(e) { res.status(500).json({ success:false, message:'Unable to remove restriction' }); }
});

router.post('/:userId/hide', auth, async (req,res) => {
  try {
    if (!validId(req.params.userId) || req.user._id.toString() === req.params.userId) return res.status(400).json({ success:false, message:'Invalid user' });
    const target = await User.findById(req.params.userId).select('_id');
    if (!target) return res.status(404).json({ success:false, message:'User not found' });
    await UserSafetyAction.findOneAndUpdate({ actor:req.user._id, target:target._id, type:'hide_content' }, { actor:req.user._id, target:target._id, type:'hide_content' }, { upsert:true });
    res.json({ success:true, hidden:true });
  } catch(e) { res.status(500).json({ success:false, message:'Unable to hide content' }); }
});

router.delete('/:userId/hide', auth, async (req,res) => {
  try {
    if (!validId(req.params.userId)) return res.status(400).json({ success:false, message:'Invalid user' });
    await UserSafetyAction.deleteOne({ actor:req.user._id, target:req.params.userId, type:'hide_content' });
    res.json({ success:true, hidden:false });
  } catch(e) { res.status(500).json({ success:false, message:'Unable to unhide content' }); }
});

router.post('/:userId/report', auth, async (req,res) => {
  try {
    if (!validId(req.params.userId) || req.user._id.toString() === req.params.userId) return res.status(400).json({ success:false, message:'Invalid user' });
    const target = await User.findById(req.params.userId).select('_id');
    if (!target) return res.status(404).json({ success:false, message:'User not found' });
    const reason = String(req.body.reason || 'other');
    const allowed = ['spam','harassment','hate','scam','inappropriate','impersonation','other'];
    if (!allowed.includes(reason)) return res.status(400).json({ success:false, message:'Invalid report reason' });
    const description = String(req.body.description || '').slice(0,1000);
    const report = await Report.create({ reporter:req.user._id, reportedUser:target._id, reason, description });
    res.status(201).json({ success:true, reportId:report._id });
  } catch(e) { console.error('Report error',e); res.status(500).json({ success:false, message:'Unable to submit report' }); }
});

router.get('/status/:userId', auth, async (req,res) => {
  try {
    if (!validId(req.params.userId) || req.user._id.toString() === req.params.userId) return res.status(400).json({ success:false, message:'Invalid user' });
    const [me, restrict, hidden] = await Promise.all([
      User.findById(req.user._id).select('blockedUsers'),
      UserSafetyAction.exists({ actor:req.user._id, target:req.params.userId, type:'restrict' }),
      UserSafetyAction.exists({ actor:req.user._id, target:req.params.userId, type:'hide_content' })
    ]);
    res.json({ success:true, blocked:!!me?.blockedUsers?.some(id=>id.toString()===req.params.userId), restricted:!!restrict, hidden:!!hidden });
  } catch(e) { res.status(500).json({ success:false, message:'Unable to load safety status' }); }
});

router.get('/account/export', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const [user, blogs, comments, notifications, reports] = await Promise.all([
      User.findById(userId).select('-password -salt -__v').lean(),
      Blog.find({ createdBy: userId }).select('-__v').lean(),
      Comment.find({ createdBy: userId }).select('-__v').lean(),
      Notification.find({ recipient: userId }).select('-__v').lean(),
      Report.find({ reporter: userId }).select('-__v').lean()
    ]);
    if (!user) return res.status(404).json({ success:false, message:'User not found' });
    res.json({ success:true, exportedAt:new Date().toISOString(), data:{ user, blogs, comments, notifications, reports } });
  } catch (e) {
    console.error('Account export error', e);
    res.status(500).json({ success:false, message:'Unable to export account data' });
  }
});

module.exports = router;