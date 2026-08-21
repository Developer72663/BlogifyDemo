const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/user');

const router = express.Router();
const auth = (req, res, next) => req.user ? next() : res.status(401).json({ success: false, message: 'Authentication required' });

router.get('/:userId', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) return res.status(400).json({ success: false, message: 'Invalid profile' });
    const [profile, viewer] = await Promise.all([
      User.findById(req.params.userId).select('_id fullName isPrivate followers following blockedUsers').lean(),
      User.findById(req.user._id).select('_id blockedUsers').lean()
    ]);
    if (!profile || profile.blockedUsers?.some(id => id.toString() === req.user._id.toString()) || viewer?.blockedUsers?.some(id => id.toString() === profile._id.toString())) {
      return res.status(404).json({ success: false, message: 'Profile unavailable' });
    }
    const viewerId = req.user._id.toString();
    const isFollowing = profile.followers?.some(id => id.toString() === viewerId) || false;
    const followsYou = profile.following?.some(id => id.toString() === viewerId) || false;
    res.json({ success: true, profile: { _id: profile._id, fullName: profile.fullName, isPrivate: profile.isPrivate, isFollowing, followsYou, isMutual: isFollowing && followsYou } });
  } catch (error) {
    console.error('Message profile metadata:', error.message);
    res.status(500).json({ success: false, message: 'Unable to load profile metadata' });
  }
});

module.exports = router;
