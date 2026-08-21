const express=require("express");
const mongoose=require("mongoose");
const multer=require("multer");
const cloudinary=require("cloudinary").v2;
const Conversation=require("../models/Conversation");
const Message=require("../models/Message");
const User=require("../models/user");
const {messageMediaLimiter}=require("../middlewares/rateLimiting");
const router=express.Router();
const auth=(req,res,next)=>req.user?next():res.status(401).json({success:false,message:"Authentication required"});
const id=x=>mongoose.Types.ObjectId.isValid(x);
const isFollower=(user,viewerId)=>Array.isArray(user?.followers)&&user.followers.some(x=>x.toString()===viewerId.toString());
const isBlocked=(user,viewerId)=>Array.isArray(user?.blockedUsers)&&user.blockedUsers.some(x=>x.toString()===viewerId.toString());

async function canMessage(senderId,target){
  if(!target||isBlocked(target,senderId))return false;
  const setting=target.messageSettings?.whoCanMessage||"everyone";
  const follows=isFollower(target,senderId);
  if(setting==="no_one")return false;
  if(setting==="followers"&&!follows)return false;
  if(target.isPrivate&&!follows)return false;
  return true;
}

const AUDIO_MIMETYPES=new Set(["audio/webm","audio/ogg","audio/mpeg","audio/mp3","audio/mp4","audio/aac","audio/wav","audio/x-wav","audio/x-m4a","audio/mp4a-latm","audio/m4a"]);
const IMAGE_MIMETYPES=/^image\/(jpeg|jpg|png|gif|webp)$/;
const VIDEO_MIMETYPES=/^video\/(mp4|webm|quicktime|x-msvideo)$/;
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:60*1024*1024,files:1},fileFilter:(req,file,cb)=>{const mime=String(file.mimetype||"").toLowerCase().split(";")[0].trim();if(IMAGE_MIMETYPES.test(mime)||VIDEO_MIMETYPES.test(mime)||AUDIO_MIMETYPES.has(mime))return cb(null,true);cb(new Error("Only supported images, videos and audio recordings are allowed"));}});
function cloudinaryConfig(){const cloudName=process.env.CLOUD_NAME,apiKey=process.env.API_KEY,apiSecret=process.env.API_SECRET;if(!cloudName||!apiKey||!apiSecret)throw new Error("Image upload service is not configured");cloudinary.config({cloud_name:cloudName,api_key:apiKey,api_secret:apiSecret});}
function uploadToCloudinary(file){cloudinaryConfig();const mime=String(file.mimetype||"").toLowerCase().split(";")[0].trim();const isAudio=mime.startsWith("audio/");const resourceType=(mime.startsWith("video/")||isAudio)?"video":"image";return new Promise((resolve,reject)=>{const stream=cloudinary.uploader.upload_stream({folder:"blogify/messages",resource_type:resourceType,use_filename:false,unique_filename:true,overwrite:false},(err,result)=>{if(err)return reject(err);if(!result?.secure_url)return reject(new Error("Media upload did not return a URL"));resolve({url:result.secure_url,type:isAudio?"audio":resourceType});});stream.on("error",reject);stream.end(file.buffer);});}

async function getUnreadCounts(conversationIds,userId){
  if(!conversationIds.length)return new Map();
  const rows=await Message.aggregate([{$match:{conversationId:{$in:conversationIds},receiverId:userId,isRead:false}},{$group:{_id:"$conversationId",count:{$sum:1}}}]);
  return new Map(rows.map(x=>[String(x._id),x.count]));
}

async function loadConversationList(userId){
  const conversations=await Conversation.find({participants:userId})
    .sort({lastMessageAt:-1,updatedAt:-1})
    .populate("participants","fullName profileImageURL isPrivate blockedUsers messageSettings")
    .populate("lastMessage","text mediaUrl mediaType profileShareId senderId receiverId status isRead createdAt")
    .lean();
  const visible=conversations.filter(c=>{
    const other=c.participants.find(p=>String(p._id)!==String(userId));
    const me=c.participants.find(p=>String(p._id)===String(userId));
    return other&&!isBlocked(other,userId)&&!isBlocked(me,other?._id);
  });
  const ids=visible.map(c=>c._id);
  const unread=await getUnreadCounts(ids,userId);
  const missingIds=visible.filter(c=>!c.lastMessage).map(c=>c._id);
  const fallback=new Map();
  if(missingIds.length){
    const rows=await Message.aggregate([{$match:{conversationId:{$in:missingIds}}},{$sort:{createdAt:-1}},{$group:{_id:"$conversationId",message:{$first:{_id:"$_id",text:"$text",mediaUrl:"$mediaUrl",mediaType:"$mediaType",profileShareId:"$profileShareId",senderId:"$senderId",receiverId:"$receiverId",status:"$status",isRead:"$isRead",createdAt:"$createdAt"}}}}]);
    rows.forEach(x=>fallback.set(String(x._id),x.message));
  }
  const result=visible.map(c=>{
    const last=c.lastMessage||fallback.get(String(c._id));
    if(!last)return null;
    return {...c,participants:c.participants.map(({blockedUsers,messageSettings,...p})=>p),lastMessage:last,lastMessageAt:last.createdAt,unreadCount:unread.get(String(c._id))||0};
  }).filter(Boolean);
  result.sort((a,b)=>new Date(b.lastMessageAt)-new Date(a.lastMessageAt));
  return result;
}

router.get("/unread/count",auth,async(req,res)=>{try{const count=await Message.countDocuments({receiverId:req.user._id,isRead:false});res.json({success:true,unreadCount:count});}catch(e){res.status(500).json({success:false,message:"Unable to get message count"});}});
router.get("/history",auth,async(req,res)=>{try{const result=await loadConversationList(req.user._id);res.json({success:true,conversations:result});}catch(e){console.error("chat history:",e);res.status(500).json({success:false,message:"Unable to load chat history"});}});
router.get("/",auth,async(req,res)=>{try{const result=await loadConversationList(req.user._id);res.json({success:true,conversations:result});}catch(e){console.error("conversation list:",e);res.status(500).json({success:false,message:"Unable to load conversations"});}});
router.post("/conversation",auth,async(req,res)=>{try{const {userId}=req.body;if(!id(userId)||userId.toString()===req.user._id.toString())return res.status(400).json({success:false,message:"Invalid user"});const [target,sender]=await Promise.all([User.findById(userId).select("_id fullName profileImageURL isPrivate followers blockedUsers messageSettings"),User.findById(req.user._id).select("_id blockedUsers")]);if(!target)return res.status(404).json({success:false,message:"User not found"});if(isBlocked(target,req.user._id)||isBlocked(sender,target._id))return res.status(403).json({success:false,message:"You cannot message this user"});if(!(await canMessage(req.user._id,target)))return res.status(403).json({success:false,message:"This user does not currently accept messages from you."});let conversation=await Conversation.findOne({participants:{$all:[req.user._id,target._id],$size:2}});if(!conversation)conversation=await Conversation.create({participants:[req.user._id,target._id]});res.json({success:true,conversationId:conversation._id,target:{_id:target._id,fullName:target.fullName,profileImageURL:target.profileImageURL,isPrivate:target.isPrivate}});}catch(e){console.error("create conversation:",e);res.status(500).json({success:false,message:"Unable to create conversation"});}});

router.post("/upload",auth,messageMediaLimiter,upload.single("media"),async(req,res)=>{try{if(!req.file)return res.status(400).json({success:false,message:"Select a photo, video or audio recording"});const mime=String(req.file.mimetype||"").toLowerCase().split(";")[0].trim();const result=await uploadToCloudinary(req.file);res.json({success:true,mediaUrl:result.url,mediaType:result.type,mimeType:mime});}catch(e){console.error("message media upload:",e);res.status(400).json({success:false,message:e.message||"Unable to upload media"});}});

router.post("/block/:userId",auth,async(req,res)=>{try{if(!id(req.params.userId)||String(req.params.userId)===String(req.user._id))return res.status(400).json({success:false,message:"Invalid user"});const target=await User.findById(req.params.userId);if(!target)return res.status(404).json({success:false,message:"User not found"});await User.findByIdAndUpdate(req.user._id,{$addToSet:{blockedUsers:target._id},$pull:{following:target._id,followers:target._id}});await User.findByIdAndUpdate(target._id,{$pull:{following:req.user._id,followers:req.user._id}});await Conversation.deleteMany({participants:{$all:[req.user._id,target._id],$size:2}});res.json({success:true,blocked:true,message:`${target.fullName} blocked`});}catch(e){console.error("block user:",e);res.status(500).json({success:false,message:"Unable to block user"});}});
router.delete("/block/:userId",auth,async(req,res)=>{try{if(!id(req.params.userId)||String(req.params.userId)===String(req.user._id))return res.status(400).json({success:false,message:"Invalid user"});await User.findByIdAndUpdate(req.user._id,{$pull:{blockedUsers:req.params.userId}});res.json({success:true,blocked:false});}catch(e){res.status(500).json({success:false,message:"Unable to unblock user"});}});
router.get("/blocked",auth,async(req,res)=>{try{const u=await User.findById(req.user._id).populate("blockedUsers","fullName profileImageURL").lean();res.json({success:true,users:u?.blockedUsers||[]});}catch(e){res.status(500).json({success:false,message:"Unable to load blocked users"});}});

router.post("/share-profile",auth,async(req,res)=>{try{const {recipientId,profileId}=req.body;if(!id(recipientId)||!id(profileId)||String(recipientId)===String(req.user._id))return res.status(400).json({success:false,message:"Invalid recipient"});const [target,profile,sender]=await Promise.all([User.findById(recipientId).select("_id fullName isPrivate followers blockedUsers messageSettings"),User.findById(profileId).select("_id fullName profileImageURL bio isPrivate followers blockedUsers"),User.findById(req.user._id).select("_id blockedUsers")]);if(!target||!profile)return res.status(404).json({success:false,message:"User not found"});if(isBlocked(target,req.user._id)||isBlocked(sender,target._id))return res.status(403).json({success:false,message:"You cannot message this user"});if(!(await canMessage(req.user._id,target)))return res.status(403).json({success:false,message:"You cannot message this user"});if(profile.isPrivate&&String(profile._id)!==String(req.user._id)&&!isFollower(profile,req.user._id))return res.status(403).json({success:false,message:"You cannot share a private profile you do not follow."});let c=await Conversation.findOne({participants:{$all:[req.user._id,target._id],$size:2}});if(!c)c=await Conversation.create({participants:[req.user._id,target._id]});const m=await Message.create({conversationId:c._id,senderId:req.user._id,receiverId:target._id,text:`Shared profile: ${profile.fullName}`,mediaType:"profile",profileShareId:profile._id});c.lastMessage=m._id;c.lastMessageAt=new Date();await c.save();res.json({success:true,conversationId:c._id,message:m,profile});}catch(e){console.error("share profile:",e);res.status(500).json({success:false,message:"Unable to share profile"});}});

router.get("/settings",auth,(req,res)=>res.render("message-settings",{title:"Message Settings",user:req.user}));
router.get("/settings/api",auth,async(req,res)=>{try{const user=await User.findById(req.user._id).select("messageSettings").lean();res.json({success:true,messageSettings:user?.messageSettings||{}});}catch(e){res.status(500).json({success:false,message:"Unable to load message settings"});}});
router.patch("/settings/api",auth,async(req,res)=>{try{const allowed={whoCanMessage:new Set(["everyone","followers","no_one"]),messageRequests:"boolean",readReceipts:"boolean",typingIndicator:"boolean",onlineStatus:new Set(["everyone","followers","off"]),messageNotifications:"boolean",messagePreview:"boolean",notificationSound:"boolean",mediaAutoDownload:new Set(["wifi_mobile","wifi_only","never"]),allowPhotoMessages:"boolean",allowVideoMessages:"boolean",messageLikes:"boolean",groupInvites:new Set(["everyone","followers","no_one"]),hiddenWords:"boolean",autoDelete:new Set(["never","24h","7d","30d"])};const updates={};for(const [key,rule] of Object.entries(allowed)){if(!Object.prototype.hasOwnProperty.call(req.body,key))continue;const value=req.body[key];const valid=rule instanceof Set?rule.has(value):rule==="boolean"&&typeof value==="boolean";if(!valid)return res.status(400).json({success:false,message:`Invalid value for ${key}`});updates[`messageSettings.${key}`]=value;}if(!Object.keys(updates).length)return res.status(400).json({success:false,message:"No valid settings supplied"});const user=await User.findByIdAndUpdate(req.user._id,{$set:updates},{new:true,runValidators:true}).select("messageSettings").lean();res.json({success:true,messageSettings:user.messageSettings});}catch(e){console.error("message settings update:",e);res.status(400).json({success:false,message:e.message||"Unable to save message settings"});}});

router.delete("/conversation/:conversationId",auth,async(req,res)=>{try{if(!id(req.params.conversationId))return res.status(400).json({success:false,message:"Invalid conversation"});const conversation=await Conversation.findOne({_id:req.params.conversationId,participants:req.user._id}).select("_id participants");if(!conversation)return res.status(404).json({success:false,message:"Conversation not found"});await Message.deleteMany({conversationId:conversation._id});await Conversation.deleteOne({_id:conversation._id});res.json({success:true,message:"Conversation deleted"});}catch(e){console.error("delete conversation:",e);res.status(500).json({success:false,message:"Unable to delete conversation"});}});

router.get("/:conversationId",auth,async(req,res)=>{try{if(!id(req.params.conversationId))return res.status(400).json({success:false,message:"Invalid conversation"});const c=await Conversation.findOne({_id:req.params.conversationId,participants:req.user._id}).populate("participants","fullName profileImageURL isPrivate blockedUsers messageSettings").lean();if(!c)return res.status(403).json({success:false,message:"Conversation unavailable"});const other=c.participants.find(p=>String(p._id)!==String(req.user._id));const me=c.participants.find(p=>String(p._id)===String(req.user._id));if(!other||isBlocked(other,req.user._id)||isBlocked(me,other._id))return res.status(403).json({success:false,message:"Conversation unavailable"});const requested=Math.min(Math.max(parseInt(req.query.limit,10)||50,10),100);const before=req.query.before&&!Number.isNaN(Date.parse(req.query.before))?new Date(req.query.before):null;const filter={conversationId:c._id};if(before)filter.createdAt={$lt:before};let messages=await Message.find(filter).sort({createdAt:-1}).limit(requested).populate("senderId","fullName profileImageURL").populate("replyTo","text senderId").populate("profileShareId","fullName profileImageURL bio isPrivate").lean();messages.reverse();const hasMore=messages.length===requested;const newest=messages[messages.length-1];if(!before&&newest)await Conversation.updateOne({_id:c._id},{$set:{lastMessage:newest._id,lastMessageAt:newest.createdAt}});if(me?.messageSettings?.readReceipts!==false)await Message.updateMany({conversationId:c._id,receiverId:req.user._id,isRead:false},{$set:{isRead:true,status:"read"}});res.json({success:true,messages,hasMore,conversation:{...c,participants:c.participants.map(({blockedUsers,messageSettings,...p})=>p)}});}catch(e){console.error("conversation history:",e);res.status(500).json({success:false,message:"Unable to load messages"});}});
router.post("/:messageId/like",auth,async(req,res)=>{try{if(!id(req.params.messageId))return res.status(400).json({success:false,message:"Invalid message"});const m=await Message.findOne({_id:req.params.messageId,$or:[{senderId:req.user._id},{receiverId:req.user._id}]});if(!m||m.deleted)return res.status(404).json({success:false,message:"Message not found"});const uid=req.user._id.toString();const liked=m.likes.some(x=>x.toString()===uid);if(liked)m.likes.pull(req.user._id);else m.likes.push(req.user._id);await m.save();res.json({success:true,liked:!liked,likes:m.likes.length});}catch(e){res.status(500).json({success:false,message:"Unable to like message"});}});
router.delete("/:messageId",auth,async(req,res)=>{try{if(!id(req.params.messageId))return res.status(400).json({success:false,message:"Invalid message"});const m=await Message.findOne({_id:req.params.messageId,senderId:req.user._id});if(!m)return res.status(404).json({success:false,message:"Message not found"});m.text="Message deleted";m.mediaUrl="";m.mediaType="";m.profileShareId=null;m.deleted=true;await m.save();res.json({success:true});}catch(e){res.status(500).json({success:false,message:"Unable to delete message"});}});
module.exports=router;
