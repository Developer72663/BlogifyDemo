const mongoose=require("mongoose");
const {Schema,model}=mongoose;
const NotificationSchema=new Schema({recipient:{type:Schema.Types.ObjectId,ref:"user",required:true},type:{type:String,enum:["comment","reply","like","follow","follow_request","mention","blog_post","message"],required:true},title:String,message:String,blog:{type:Schema.Types.ObjectId,ref:"blog"},actor:{type:Schema.Types.ObjectId,ref:"user"},request:{type:Schema.Types.ObjectId,ref:"FollowRequest"},messageRef:{type:Schema.Types.ObjectId,ref:"Message",default:null},conversationId:{type:Schema.Types.ObjectId,ref:"Conversation",default:null},isRead:{type:Boolean,default:false}},{timestamps:true});
NotificationSchema.index({recipient:1,isRead:1});
NotificationSchema.index({createdAt:1},{expireAfterSeconds:14*24*60*60});
NotificationSchema.index({recipient:1,type:1,messageRef:1});

// Deliver every persisted in-app notification through Web Push when the user
// has explicitly enabled push notifications. This keeps comments, replies,
// likes, follows, mentions and messages on the same reliable push path.
NotificationSchema.post("save",function(notification){
    setImmediate(async()=>{
        try{
            const {sendToUser}=require("../services/webPush");
            const User=require("./user");
            const user=await User.findById(notification.recipient)
                .select("notificationSettings.pushEnabled notificationSettings.pushOnMessage notificationSettings.pushOnComment notificationSettings.pushOnReply notificationSettings.pushOnLike notificationSettings.pushOnFollow notificationSettings.pushOnFollowRequest notificationSettings.pushOnMention notificationSettings.pushOnBlogPost")
                .lean();
            const settings=user?.notificationSettings;
            if(!settings?.pushEnabled)return;

            const settingByType={
                message:"pushOnMessage",
                comment:"pushOnComment",
                reply:"pushOnReply",
                like:"pushOnLike",
                follow:"pushOnFollow",
                follow_request:"pushOnFollowRequest",
                mention:"pushOnMention",
                blog_post:"pushOnBlogPost"
            };
            const settingName=settingByType[notification.type];
            if(settingName&&settings[settingName]===false)return;

            const url=notification.conversationId
                ? `/messages?conversation=${notification.conversationId}`
                : notification.blog
                    ? `/blogs/${notification.blog}`
                    : "/notifications";

            await sendToUser(notification.recipient,{
                title:notification.title||"Blogify",
                body:notification.message||"You have a new notification",
                icon:"/imgs/default.png",
                badge:"/imgs/default.png",
                tag:`blogify-${notification.type}-${notification.messageRef||notification._id}`,
                renotify:true,
                data:{url,type:notification.type,notificationId:String(notification._id)}
            },{urgency:notification.type==="message"?"high":"normal",ttl:300});
        }catch(error){
            console.error("Web Push delivery error:",error.message);
        }
    });
});

const Notification=mongoose.models.Notification||model("Notification",NotificationSchema);module.exports=Notification;
