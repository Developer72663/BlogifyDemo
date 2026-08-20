const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const Blog = require("../models/Blog");
const BlogView = require("../models/BlogView");
const User = require("../models/user");
const { restrictToLoggedInUserOnly } = require("../middlewares/authentication");
const { blogCreationLimiter } = require("../middlewares/rateLimiting");
const cloudinaryUpload = require("../middlewares/CloudinaryUploads");
const mediaUpload = cloudinaryUpload.mediaUpload;
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

router.post("/add-new",blogCreationLimiter,mediaUpload.single("mediaFile"),async(req,res)=>{
    try{
        const {title,body,tags,category,status,metaDescription,excerpt,mediaType="blog"}=req.body;
        if(!["blog","photo","video"].includes(mediaType))return res.status(400).render("addBlog",{user:req.user,error:"Invalid post type."});

        // Accept the canonical `body` field while remaining compatible with older clients
        // that may still send `content` or `description`.
        const submittedBody=typeof body==="string"?body:"";
        const fallbackBody=typeof req.body.content==="string"?req.body.content:(typeof req.body.description==="string"?req.body.description:"");
        const effectiveBody=submittedBody.trim()?submittedBody:fallbackBody;
        const effectiveTitle=(typeof title==="string"?title:"").trim();
        const mediaBody=mediaType!=="blog"&&effectiveBody.trim().length===0?(typeof excerpt==="string"&&excerpt.trim()?excerpt:(effectiveTitle||`${mediaType} post`)):effectiveBody;
        const validation=validateBlog(effectiveTitle,mediaBody,tags?tags.split(","):[]);
        if(!validation.isValid)return res.status(400).render("addBlog",{user:req.user,error:validation.errors.join(", ")});
        if(mediaType==="video"&&!req.file)return res.status(400).render("addBlog",{user:req.user,error:"Please select a video."});
        if(mediaType==="photo"&&!req.file)return res.status(400).render("addBlog",{user:req.user,error:"Please select a photo."});
        if(mediaType==="blog"&&req.file&&!req.file.mimetype.startsWith("image/"))return res.status(400).render("addBlog",{user:req.user,error:"A blog cover must be an image."});
        let coverImageURL=null,videoURL=null,videoDuration=null;
        if(req.file&&mediaType==="video"){
            if(!req.file.mimetype.startsWith("video/"))return res.status(400).render("addBlog",{user:req.user,error:"Please select a video file."});
            const result=await cloudinaryUpload.uploadVideoBuffer(req.file.buffer,{folder:"blogify_videos"});
            videoURL=result.secure_url;videoDuration=Math.min(Number(result.duration||60),60);
        }else if(req.file){
            coverImageURL=await uploadCoverImage(req.file);
        }
        const tagsArray=tags?tags.split(",").map(t=>t.trim()).filter(Boolean):[];
        const newBlog=await Blog.create({title:sanitizeInput(effectiveTitle),body:sanitizeInput(mediaBody),coverImageURL,videoURL,videoDuration,mediaType,tags:tagsArray,category:category||"General",status:status||"published",metaDescription:sanitizeInput(metaDescription),excerpt:sanitizeInput(excerpt),createdBy:req.user._id});
        await require("../models/BlogAnalytics").create({blog:newBlog._id,author:req.user._id});
        if(newBlog.status==="published")try{await NotificationService.createBlogPostNotifications(req.user._id,newBlog._id,newBlog.title);}catch(e){console.error(e);}
        res.redirect(`/blogs/${newBlog._id}`);
    }catch(error){console.error("Blog Creation Error:",error);res.status(400).render("addBlog",{user:req.user,error:error.message||"Something went wrong while creating the post."});}
});

function makeAnonymousViewerKey(req){
    const secret=process.env.VIEW_HASH_SECRET||process.env.JWT_SECRET;
    if(!secret)throw new Error("VIEW_HASH_SECRET/JWT_SECRET is required for anonymous view tracking");
    const userAgent=String(req.headers["user-agent"]||"").slice(0,512);
    return crypto.createHmac("sha256",secret).update(`${req.ip}|${userAgent}`).digest("hex");
}

async function countView(blogId, req){
    const viewerKey=req.user?String(req.user._id):makeAnonymousViewerKey(req);
    const bucket=Math.floor(Date.now()/(24*60*60*1000));
    try{
        await BlogView.create({blog:blogId,viewerKey,bucket,isAuthenticated:!!req.user});
    }catch(error){
        if(error?.code===11000)return false;
        throw error;
    }
    await Blog.updateOne({_id:blogId},{$inc:{viewCount:1}});
    await AnalyticsService.trackView(blogId,req.user?._id,"direct");
    return true;
}

async function renderBlog(req,res){
    const blog=await Blog.findById(req.params.id).notDeleted().populate("createdBy","fullName profileImageURL bio followers").lean();
    if(!blog)return res.status(404).send("Blog not found");
    if(!(await canAccessBlog(blog,req.user?._id)))return res.status(403).render("error",{user:req.user||null,error:"This blog is private. Follow the author to read it."});
    await countView(blog._id,req);
    const updatedBlog=await Blog.findById(req.params.id).notDeleted().populate("createdBy","fullName profileImageURL bio followers").lean();
    const candidateRelated=await Blog.find({tags:{$in:blog.tags||[]},_id:{$ne:blog._id},isDeleted:false,status:"published"}).limit(12).lean();
    const relatedBlogs=[];for(const item of candidateRelated){if(await canAccessBlog(item,req.user?._id)&&relatedBlogs.length<5)relatedBlogs.push(item);}
    const candidateAuthorBlogs=await Blog.find({createdBy:blog.createdBy._id,_id:{$ne:blog._id},isDeleted:false,status:"published"}).sort({createdAt:-1}).limit(12).lean();
    const authorBlogs=[];for(const item of candidateAuthorBlogs){if(await canAccessBlog(item,req.user?._id)&&authorBlogs.length<5)authorBlogs.push(item);}
    const hasLiked=req.user?updatedBlog.likes.some(id=>id.toString()===req.user._id.toString()):false;
    res.render("view",{user:req.user,blog:updatedBlog,relatedBlogs,authorBlogs,hasLiked});
}

router.get("/tags/:tag",async(req,res)=>{try{const {tag}=req.params,{page=1}=req.query,limit=9,skip=(page-1)*limit;const privateUsers=req.user?await User.find({isPrivate:true,_id:{$nin:[req.user._id]}}).select("_id followers").lean():await User.find({isPrivate:true}).select("_id").lean();const followedPrivate=req.user?privateUsers.filter(u=>u.followers.some(id=>id.toString()===req.user._id.toString())).map(u=>u._id):[];const filter={tags:tag,status:"published",isDeleted:false,$or:[{createdBy:{$nin:privateUsers.map(u=>u._id)}},{createdBy:{$in:followedPrivate}}]};const blogs=await Blog.find(filter).sort({createdAt:-1}).skip(skip).limit(limit).populate("createdBy","fullName profileImageURL").lean();const total=await Blog.countDocuments(filter);res.render("taggedBlogs",{user:req.user,blogs,tag,currentPage:parseInt(page),totalPages:Math.ceil(total/limit)});}catch(error){console.error("Tagged Blogs Error:",error);res.status(500).send("Internal Server Error");}});
router.get("/featured/list",async(req,res)=>{try{const blogs=await Blog.find({isFeatured:true,status:"published",isDeleted:false}).sort({featuredRank:1,createdAt:-1}).populate("createdBy","fullName profileImageURL").lean();const visible=[];for(const blog of blogs)if(await canAccessBlog(blog,req.user?._id))visible.push(blog);res.json({success:true,blogs:visible});}catch(error){res.status(500).json({success:false,message:"Failed to fetch featured blogs"});}});
router.get("/:id/edit",async(req,res)=>{try{const blog=await Blog.findById(req.params.id).notDeleted().lean();if(!blog)return res.status(404).send("Blog not found");if(blog.createdBy.toString()!==req.user._id.toString())return res.status(403).send("You are not authorized to edit this blog");res.render("editBlog",{user:req.user,blog,error:null});}catch(error){console.error(error);res.status(500).send("Internal Server Error");}});
router.get("/:id",async(req,res)=>{try{await renderBlog(req,res);}catch(error){console.error("Single Blog Error:",error);res.status(500).send("Internal Server Error");}});
router.put("/:id",mediaUpload.single("mediaFile"),async(req,res)=>{try{const {title,body,tags,category,status,metaDescription,excerpt,mediaType="blog"}=req.body;const blog=await Blog.findById(req.params.id);if(!blog)return res.status(404).json({success:false,message:"Blog not found"});if(blog.createdBy.toString()!==req.user._id.toString())return res.status(403).json({success:false,message:"Not authorized"});if(!["blog","photo","video"].includes(mediaType))return res.status(400).json({success:false,message:"Invalid post type"});const validation=validateBlog(title,body,tags?tags.split(","):[]);if(!validation.isValid)return res.status(400).json({success:false,errors:validation.errors});blog.title=sanitizeInput(title);blog.body=sanitizeInput(body);blog.tags=tags?tags.split(",").map(t=>t.trim()).filter(Boolean):[];blog.category=category||"General";blog.status=status||"published";blog.metaDescription=sanitizeInput(metaDescription);blog.excerpt=sanitizeInput(excerpt);blog.mediaType=mediaType;if(req.file&&mediaType==="video"){const result=await cloudinaryUpload.uploadVideoBuffer(req.file.buffer,{folder:"blogify_videos"});blog.videoURL=result.secure_url;blog.videoDuration=Math.min(Number(result.duration||60),60);blog.coverImageURL=null;}else if(req.file){blog.coverImageURL=await uploadCoverImage(req.file);blog.videoURL=null;blog.videoDuration=null;}await blog.save();res.json({success:true,blog});}catch(error){console.error(error);res.status(500).json({success:false,message:error.message||"Failed to update blog"});}});
router.delete("/:id",async(req,res)=>{try{const blog=await Blog.findById(req.params.id);if(!blog)return res.status(404).json({success:false,message:"Blog not found"});if(blog.createdBy.toString()!==req.user._id.toString())return res.status(403).json({success:false,message:"Not authorized"});blog.isDeleted=true;blog.deletedAt=new Date();await blog.save();res.json({success:true,message:"Blog deleted successfully"});}catch(error){res.status(500).json({success:false,message:"Failed to delete blog"});}});
router.post("/:id/like",async(req,res)=>{try{const blog=await Blog.findById(req.params.id);if(!blog)return res.status(404).json({success:false,message:"Blog not found"});if(!(await canAccessBlog(blog,req.user._id)))return res.status(403).json({success:false,message:"Only followers can like this private blog"});const hasLiked=blog.likes.some(id=>id.toString()===req.user._id.toString());if(hasLiked)blog.likes=blog.likes.filter(id=>id.toString()!==req.user._id.toString());else{blog.likes.push(req.user._id);if(blog.createdBy.toString()!==req.user._id.toString())await NotificationService.createNotification(blog.createdBy,"like",{title:"New like",message:`${req.user.fullName} liked your blog`,blog:blog._id,actor:req.user._id});}await blog.save();res.json({success:true,liked:!hasLiked,likeCount:blog.likes.length});}catch(error){console.error(error);res.status(500).json({success:false,message:"Failed to like blog"});}});
module.exports=router;
