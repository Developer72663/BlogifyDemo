const express=require("express");
const mongoose=require("mongoose");
const User=require("../models/user");
const Message=require("../models/Message");
const router=express.Router();
const auth=(req,res,next)=>req.user?next():res.status(401).json({success:false,message:"Authentication required"});

router.post("/conversation",auth,async(req,res,next)=>{try{const target=await User.findById(req.body.userId).select("blockedUsers");if(!target)return next();const me=await User.findById(req.user._id).select("blockedUsers");if(target.blockedUsers?.some(x=>x.toString()===req.user._id.toString())||me?.blockedUsers?.some(x=>x.toString()===target._id.toString()))return res.status(403).json({success:false,message:"You cannot message this user because one of you has blocked the other."});next();}catch(e){next(e);}});
router.post("/share-profile",auth,async(req,res,next)=>{try{const target=await User.findById(req.body.recipientId).select("blockedUsers");const me=await User.findById(req.user._id).select("blockedUsers");if(target&&(target.blockedUsers?.some(x=>x.toString()===req.user._id.toString())||me?.blockedUsers?.some(x=>x.toString()===target._id.toString())))return res.status(403).json({success:false,message:"You cannot message this user because one of you has blocked the other."});next();}catch(e){next(e);}});
router.post("/:messageId/like",auth,async(req,res,next)=>{try{if(!mongoose.Types.ObjectId.isValid(req.params.messageId))return res.status(400).json({success:false,message:"Invalid message"});const message=await Message.findOne({_id:req.params.messageId,$or:[{senderId:req.user._id},{receiverId:req.user._id}]}).select("senderId deleted").lean();if(!message)return res.status(404).json({success:false,message:"Message not found"});if(message.deleted)return res.status(404).json({success:false,message:"Message not found"});const owner=await User.findById(message.senderId).select("messageSettings").lean();if(owner?.messageSettings?.messageLikes===false)return res.status(403).json({success:false,message:"Reactions are disabled for this message owner."});next();}catch(e){next(e);}});
module.exports=router;
