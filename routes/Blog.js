const express = require("express");
const router = express.Router();
const Blog = require("../models/Blog");
const User = require("../models/user");
const { restrictToLoggedInUserOnly } = require("../middlewares/authentication");
const { blogCreationLimiter } = require("../middlewares/rateLimiting");
const cloudinaryUpload = require("../middlewares/CloudinaryUploads");
const { validateBlog, sanitizeInput } = require("../middlewares/validation");
const AnalyticsService = require("../services/analyticsService");
const NotificationService = require("../services/notificationService");

router.use(restrictToLoggedInUserOnly);
router.get("/add-new", (req,res)=>res.render("addBlog",{user:req.user,error:null}));

async function uploadCoverImage(file){
    if(!file)return null;
    const result=await cloudinaryUpload.uploadBuffer(file.buffer,{folder:"blogify_blogs",resource_type:"image",transformation:[{width:1600,height:1000,crop:"limit"}]});
    return result.secure_url;
}

async function canAccessBlog(blog, viewerId){
    if(!blog)return false;
    const author=await User.findById(blog.createdBy).select("isPrivate followers").lean();
    if(!author||!author.isPrivate)return true;
    return !!viewerId&&(author._id.toString()===viewerId.toString()||author.followers.some(id=>id.toString()===viewerId.toString()));
}

router.post("/add-new",blogCreationLimiter,cloudinaryUpload.single("coverImage"),async(req,res)=>{
    try{
        const {title,body,tags,category,status,metaDescription,excerpt}=req.body;
        const validation=validateBlog(title,body,tags?tags.split(","):[]);
        if(!validation.isValid)return res.render("addBlog",{user:req.user,error:validation.errors.join(", ")});
        const coverImageURL=await uploadCoverImage(req.file);
        const tagsArray=tags?tags.split(",").map(t=>t.trim()).filter(Boolean):[];
        const newBlog=await Blog.create({title:sanitizeInput(title),body:sanitizeInput(body),coverImageURL,tags:tagsArray,category:category||"General",status:status||"published",metaDescription:sanitizeInput(metaDescription),excerpt:sanitizeInput(excerpt),createdBy:req.user._id});
        await require("../models/BlogAnalytics").create({blog:newBlog._id,author:req.user._id});
        if(newBlog.status==="published")try{await NotificationService.createBlogPostNotifications(req.user._id,newBlog._id,newBlog.title);}catch(e){console.error(e);}
        res.redirect(`/blogs/${newBlog._id}`);
    }catch(error){console.error("Blog Creation Error:",error);res.status(error.message?.includes("upload")?400:500).render("addBlog",{user:req.user,error:error.message||"Something went wrong while creating the blog."});}
});

router.get("/:id/edit",async(req,res)=>{
    try{const blog=await Blog.findById(req.params.id).notDeleted().lean();if(!blog)return res.status(404).send("Blog not found");if(blog.createdBy.toString()!==req.user._id.toString())return res.status(403).send("You are not authorized to edit this blog");res.render("editBlog",{user:req.user,blog,error:null});}
    catch(error){console.error(error);res.status(500).send("Internal Server Error");}
});

router.get("/:id",async(req,res)=>{
    try{
        const blog=await Blog.findById(req.params.id).notDeleted().populate("createdBy","fullName profileImageURL bio followers").lean();
        if(!blog)return res.status(404).send("Blog not found");
        if(!(await canAccessBlog(blog,req.user?._id)))return res.status(403).render("error",{user:req.user||null,error:"This blog is private. Follow the author to read it."});
        const viewerId=req.user?req.user._id.toString():req.ip,userAgent=req.headers["user-agent"]||"",viewerFingerprint=req.user?viewerId:`${viewerId}_${Buffer.from(userAgent).toString("base64").substring(0,16)}`;
        const twentyFourHoursAgo=new Date(Date.now()-24*60*60*1000);
        const existingView=await Blog.findOne({_id:blog._id,viewers:{$elemMatch:{viewerId:viewerFingerprint,viewedAt:{$gte:twentyFourHoursAgo}}}});
        if(!existingView){await Blog.findByIdAndUpdate(blog._id,{$pull:{viewers:{viewerId:viewerFingerprint}}});await Blog.findByIdAndUpdate(blog._id,{$push:{viewers:{viewerId:viewerFingerprint,viewedAt:new Date(),isAuthenticated:!!req.user}},$inc:{viewCount:1}});await AnalyticsService.trackView(blog._id,req.user?._id,"direct");}
        const updatedBlog=await Blog.findById(req.params.id).notDeleted().populate("createdBy","fullName profileImageURL bio followers").lean();
        const candidateRelated=await Blog.find({tags:{$in:blog.tags||[]},_id:{$ne:blog._id},isDeleted:false,status:"published"}).limit(12).lean();
        const relatedBlogs=[];for(const item of candidateRelated){if(await canAccessBlog(item,req.user?._id)&&relatedBlogs.length<5)relatedBlogs.push(item);}
        const candidateAuthorBlogs=await Blog.find({createdBy:blog.createdBy._id,_id:{$ne:blog._id},isDeleted:false,status:"published"}).sort({createdAt:-1}).limit(12).lean();
        const authorBlogs=[];for(const item of candidateAuthorBlogs){if(await canAccessBlog(item,req.user?._id)&&authorBlogs.length<5)authorBlogs.push(item);}
        const hasLiked=req.user?updatedBlog.likes.some(id=>id.toString()===req.user._id.toString()):false;
        res.render("view",{user:req.user,blog:updatedBlog,relatedBlogs,authorBlogs,hasLiked});
    }catch(error){console.error("Single Blog Error:",error);res.status(500).send("Internal Server Error");}
});

router.put("/:id",cloudinaryUpload.single("coverImage"),async(req,res)=>{
    try{const {title,body,tags,category,status,metaDescription,excerpt}=req.body;const blog=await Blog.findById(req.params.id);if(!blog)return res.status(404).json({success:false,message:"Blog not found"});if(blog.createdBy.toString()!==req.user._id.toString())return res.status(403).json({success:false,message:"Not authorized"});const validation=validateBlog(title,body,tags?tags.split(","):[]);if(!validation.isValid)return res.status(400).json({success:false,errors:validation.errors});blog.title=sanitizeInput(title);blog.body=sanitizeInput(body);blog.tags=tags?tags.split(",").map(t=>t.trim()).filter(Boolean):[];blog.category=category||"General";blog.status=status||"published";blog.metaDescription=sanitizeInput(metaDescription);blog.excerpt=sanitizeInput(excerpt);if(req.file)blog.coverImageURL=await uploadCoverImage(req.file);await blog.save();res.json({success:true,blog});}
    catch(error){console.error(error);res.status(500).json({success:false,message:error.message||"Failed to update blog"});}
});

router.delete("/:id",async(req,res)=>{try{const blog=await Blog.findById(req.params.id);if(!blog)return res.status(404).json({success:false,message:"Blog not found"});if(blog.createdBy.toString()!==req.user._id.toString())return res.status(403).json({success:false,message:"Not authorized"});blog.isDeleted=true;blog.deletedAt=new Date();await blog.save();res.json({success:true,message:"Blog deleted successfully"});}catch(error){res.status(500).json({success:false,message:"Failed to delete blog"});}});

router.post("/:id/like",async(req,res)=>{
    try{const blog=await Blog.findById(req.params.id);if(!blog)return res.status(404).json({success:false,message:"Blog not found"});if(!(await canAccessBlog(blog,req.user._id)))return res.status(403).json({success:false,message:"Only followers can like this private blog"});const hasLiked=blog.likes.some(id=>id.toString()===req.user._id.toString());if(hasLiked)blog.likes=blog.likes.filter(id=>id.toString()!==req.user._id.toString());else{blog.likes.push(req.user._id);if(blog.createdBy.toString()!==req.user._id.toString())await NotificationService.createNotification(blog.createdBy,"like",{title:"New like",message:`${req.user.fullName} liked your blog`,blog:blog._id,actor:req.user._id});}await blog.save();res.json({success:true,liked:!hasLiked,likeCount:blog.likes.length});}
    catch(error){console.error(error);res.status(500).json({success:false,message:"Failed to like blog"});}
});

router.get("/featured/list",async(req,res)=>{try{const blogs=await Blog.find({isFeatured:true,status:"published",isDeleted:false}).sort({featuredRank:1,createdAt:-1}).populate("createdBy","fullName profileImageURL").lean();const visible=[];for(const blog of blogs)if(await canAccessBlog(blog,req.user?._id))visible.push(blog);res.json({success:true,blogs:visible});}catch(error){res.status(500).json({success:false,message:"Failed to fetch featured blogs"});}});

router.get("/tags/:tag",async(req,res)=>{try{const {tag}=req.params,{page=1}=req.query,limit=9,skip=(page-1)*limit;const privateUsers=req.user?await User.find({isPrivate:true,_id:{$nin:[req.user._id]}}).select("_id followers").lean():await User.find({isPrivate:true}).select("_id").lean();const followedPrivate=req.user?privateUsers.filter(u=>u.followers.some(id=>id.toString()===req.user._id.toString())).map(u=>u._id):[];const filter={tags:tag,status:"published",isDeleted:false,$or:[{createdBy:{$nin:privateUsers.map(u=>u._id)}},{createdBy:{$in:followedPrivate}}]};const blogs=await Blog.find(filter).sort({createdAt:-1}).skip(skip).limit(limit).populate("createdBy","fullName profileImageURL").lean();const total=await Blog.countDocuments(filter);res.render("taggedBlogs",{user:req.user,blogs,tag,currentPage:parseInt(page),totalPages:Math.ceil(total/limit)});}catch(error){console.error(error);res.status(500).send("Internal Server Error");}});
module.exports=router;
