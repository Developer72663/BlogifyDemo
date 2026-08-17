const mongoose=require("mongoose");
const conversationSchema=new mongoose.Schema({participants:[{type:mongoose.Schema.Types.ObjectId,ref:"user",required:true}],lastMessage:{type:mongoose.Schema.Types.ObjectId,ref:"Message",default:null},lastMessageAt:{type:Date,default:null},blockedBy:[{type:mongoose.Schema.Types.ObjectId,ref:"user"}],mutedBy:[{type:mongoose.Schema.Types.ObjectId,ref:"user"}]},{timestamps:true});
conversationSchema.index({participants:1});
module.exports=mongoose.model("Conversation",conversationSchema);