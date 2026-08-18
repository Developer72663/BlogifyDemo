const mongoose=require("mongoose");
const {Schema,model}=mongoose;
const NotificationSchema=new Schema({recipient:{type:Schema.Types.ObjectId,ref:"user",required:true},type:{type:String,enum:["comment","reply","like","follow","follow_request","mention","blog_post","message"],required:true},title:String,message:String,blog:{type:Schema.Types.ObjectId,ref:"blog"},actor:{type:Schema.Types.ObjectId,ref:"user"},request:{type:Schema.Types.ObjectId,ref:"FollowRequest"},messageRef:{type:Schema.Types.ObjectId,ref:"Message",default:null},conversationId:{type:Schema.Types.ObjectId,ref:"Conversation",default:null},isRead:{type:Boolean,default:false}},{timestamps:true});
NotificationSchema.index({recipient:1,isRead:1});
// Automatically remove notifications 14 days after they are created.
// MongoDB TTL cleanup runs automatically in the background (normally within about a minute).
NotificationSchema.index({createdAt:1},{expireAfterSeconds:14*24*60*60});
NotificationSchema.index({recipient:1,type:1,messageRef:1});
const Notification=mongoose.models.Notification||model("Notification",NotificationSchema);module.exports=Notification;