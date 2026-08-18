const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Blog = require("../models/Blog");
const User = require("../models/user");
const FollowRequest = require("../models/FollowRequest");

router.get("/:userId", async (req,res)=>{
    try{
        const {userId}=req.params;
        if(!mongoose.Types.ObjectId.isValid(userId)) return res.status(404).render("404",{user:req.user||null});
        const profileUser=await User.findById(userId).select("fullName profileImageURL bio website location isPrivate followers following createdAt").lean();
        if(!profileUser) return res.status(404).render("404",{user:req.user||null});
        const viewerId=req.user?._id?.toString();
        const isOwner=viewerId===userId;
        let viewerBlocked=false;
        let blockedViewer=false;
        if(!isOwner && viewerId){
            const [viewer, target]=await Promise.all([
                User.findById(viewerId).select("blockedUsers").lean(),
                User.findById(userId).select("blockedUsers").lean()
            ]);
            viewerBlocked=!!viewer?.blockedUsers?.some(id=>id.toString()===userId);
            blockedViewer=!!target?.blockedUsers?.some(id=>id.toString()===viewerId);
        }
        if(!isOwner && (viewerBlocked || blockedViewer)) return res.status(404).render("404",{user:req.user||null});
        const isFollowing=!!viewerId && profileUser.followers.some(id=>id.toString()===viewerId);
        const canSeePrivateContent=isOwner || !profileUser.isPrivate || isFollowing;
        const [blogCount, pendingRequest]=await Promise.all([
            Blog.countDocuments({createdBy:userId,isDeleted:false,status:"published"}),
            viewerId && !isOwner ? FollowRequest.findOne({requester:viewerId,recipient:userId,status:"pending"}).lean() : null
        ]);

        let blogs=[];
        let followers=[];
        let following=[];
        if(canSeePrivateContent){
            blogs=await Blog.find({createdBy:userId,isDeleted:false,status:"published"}).sort({createdAt:-1}).populate("createdBy","fullName profileImageURL").lean();
            followers=await User.find({_id:{$in:profileUser.followers}}).select("fullName profileImageURL bio").lean();
            following=await User.find({_id:{$in:profileUser.following}}).select("fullName profileImageURL bio").lean();
        }
        res.render("publicProfile",{
            user:req.user||null,profileUser,blogs,
            stats:{blogCount,followerCount:profileUser.followers.length,followingCount:profileUser.following.length},
            isOwner,isFollowing,isPrivate:profileUser.isPrivate,canSeePrivateContent,
            showFollowersList:canSeePrivateContent,showFollowingList:canSeePrivateContent,
            visibleFollowers:followers,visibleFollowing:following,
            followRequested:!!pendingRequest
        });
    } catch(error){ console.error("Public Profile Error:",error); res.status(500).render("error",{user:req.user||null,error:"Failed to load profile"}); }
});
module.exports=router;
