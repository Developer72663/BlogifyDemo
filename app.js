const path=require("path");
const express=require("express");
const mongoose=require("mongoose");
const cookieParser=require("cookie-parser");
const passport=require("passport");
const {createHandler}=require("graphql-http/lib/use/express");
const {Marked}=require("marked");
const {markedHighlight}=require("marked-highlight");
const hljs=require("highlight.js");
process.on("warning",warning=>{if(warning.code==="MONGOOSE"&&warning.message.includes("Duplicate schema index"))return;console.warn(warning);});
const UserRoute=require("./routes/User"),GoogleAuthRoute=require("./routes/GoogleAuthentication"),BlogRoute=require("./routes/Blog"),AdminRoute=require("./routes/Admin"),ProfileRoute=require("./routes/Profile"),PublicProfileRoute=require("./routes/publicProfile"),CommentRoute=require("./routes/Comment"),FollowRoute=require("./routes/Follow"),NotificationRoute=require("./routes/Notification"),AnalyticsRoute=require("./routes/Analytics");
const {checkForAuthenticationCookie}=require("./middlewares/authentication");
const {queryHandler}=require("./middlewares/queryParams");
const {apiLimiter}=require("./middlewares/rateLimiting");
const {schema,root}=require("./graphql/schema");
const app=express();const PORT=process.env.PORT||8000;require("dotenv").config();
const marked=new Marked(markedHighlight({emptyLangClass:"hljs",langPrefix:"hljs language-",highlight(code,lang){const language=hljs.getLanguage(lang)?lang:"plaintext";return hljs.highlight(code,{language}).value;}}));
mongoose.connect(process.env.MONGODB_URI||"mongodb://localhost:27017/blogify").then(()=>console.log("MongoDB Connected")).catch(err=>{console.error("MongoDB Connection Error:",err.message);process.exit(1);});
app.set("view engine","ejs");app.set("views",path.resolve("./views"));app.use(cookieParser());app.use(express.json());app.use(express.urlencoded({extended:true}));app.use(express.static(path.resolve("./public")));
app.use((req,res,next)=>{res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("X-Frame-Options","DENY");res.setHeader("X-XSS-Protection","1; mode=block");next();});
app.use(passport.initialize());app.use(checkForAuthenticationCookie("token"));app.use(queryHandler);app.use("/api/",apiLimiter);
app.locals.truncate=(text,length=60)=>{if(!text)return"";text=String(text);return text.length<=length?text:text.substring(0,length).trim()+"...";};
app.locals.formatDate=date=>date?new Date(date).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"}):"";
app.locals.renderMarkdown=rawContent=>{if(!rawContent)return"";let s=String(rawContent),blocks=[];s=s.replace(/```([\s\S]*?)```/g,m=>{blocks.push(m);return`__BLOGIFY_CODE_BLOCK_PLACEHOLDER_${blocks.length-1}__`;}).replace(/\/ppbr\/pp/g,"\n\n").replace(/\/ppbr\/ph2/g,"\n\n## ").replace(/\/ppbr\/ph/g,"\n\n# ").replace(/\/pp/g,"\n").replace(/\/h2pbr\/pp/g,"\n## ").replace(/\/strongpbr\/ph2/g,"\n\n## ").replace(/\/li\/ul/g,"").replace(/\/li/g,"\n* ").replace(/pbr\/pul/g,"\n\n").replace(/pbr\/p/g,"\n").replace(/<<\/strong>/g,"**").replace(/<<strong>/g,"**");s=s.replace(/__BLOGIFY_CODE_BLOCK_PLACEHOLDER_(\d+)__/g,(m,i)=>blocks[parseInt(i)]);return marked.parse(s);};
app.all("/graphql",createHandler({schema,rootValue:root,context:req=>({user:req.raw.user})}));

app.get("/",async(req,res)=>{try{
    const Blog=require("./models/Blog"),User=require("./models/user");
    const q=req.queryParams||req.query||{},search=q.search||"",sort=q.sort||"newest",page=parseInt(q.page)||1,limit=parseInt(q.limit)||9;
    const privateUsers=await User.find({isPrivate:true}).select("_id followers").lean();
    const privateIds=privateUsers.map(u=>u._id);
    const followedPrivate=req.user?privateUsers.filter(u=>u.followers.some(id=>id.toString()===req.user._id.toString())).map(u=>u._id):[];
    const visibility={$or:[{createdBy:{$nin:privateIds}},{createdBy:{$in:followedPrivate}}]};
    const filter={isDeleted:false,status:"published",...visibility};
    if(search)filter.$and=[{...visibility},{$or:[{title:{$regex:search,$options:"i"}},{body:{$regex:search,$options:"i"}}]}];
    let sortOption={createdAt:-1};if(sort==="oldest")sortOption={createdAt:1};if(sort==="title")sortOption={title:1};if(sort==="trending")sortOption={viewCount:-1};
    const skip=(page-1)*limit;
    const blogs=await Blog.find(filter).sort(sortOption).skip(skip).limit(limit).populate("createdBy","fullName profileImageURL").lean();
    // Normalize the public avatar URL once on the server so home.ejs never has to
    // guess between a missing value, an old relative value, or a malformed URL.
    for(const blog of blogs){
        const author=blog.createdBy;
        let avatar=author?.profileImageURL;
        if(typeof avatar!=="string"||!avatar.trim()) avatar="/imgs/default.png";
        else { avatar=avatar.trim(); if(avatar.startsWith("//")) avatar="https:"+avatar; else if(avatar.startsWith("http://")) avatar="https://"+avatar.slice(7); }
        if(author) author.avatarURL=avatar;
    }
    const totalBlogs=await Blog.countDocuments(filter),totalPages=Math.ceil(totalBlogs/limit);
    const featuredFilter={isFeatured:true,status:"published",isDeleted:false,...visibility};
    const featuredBlogs=await Blog.find(featuredFilter).sort({featuredRank:1,createdAt:-1}).limit(3).populate("createdBy","fullName profileImageURL").lean();
    for(const blog of featuredBlogs){
        const author=blog.createdBy;
        let avatar=author?.profileImageURL;
        if(typeof avatar!=="string"||!avatar.trim()) avatar="/imgs/default.png";
        else { avatar=avatar.trim(); if(avatar.startsWith("//")) avatar="https:"+avatar; else if(avatar.startsWith("http://")) avatar="https://"+avatar.slice(7); }
        if(author) author.avatarURL=avatar;
    }
    res.render("home",{title:"Blogify",user:req.user||null,blogs:blogs||[],featuredBlogs,currentPage:page,totalPages,totalBlogs,search,sort});
}catch(error){console.error("Home Route Error:",error);res.status(500).send("Internal Server Error");}});
app.get("/user/blog/add",checkForAuthenticationCookie("token"),(req,res)=>{if(!req.user)return res.redirect("/user/signin");res.redirect("/blogs/add-new");});
app.use("/admin",AdminRoute);app.use("/user/profile",ProfileRoute);app.use("/profile",PublicProfileRoute);app.use("/user",UserRoute);app.use("/user",GoogleAuthRoute);app.use("/blogs",BlogRoute);app.use("/comments",CommentRoute);app.use("/follow",FollowRoute);app.use("/notifications",NotificationRoute);app.use("/analytics",AnalyticsRoute);
app.use((req,res)=>res.status(404).render("404"));app.use((err,req,res,next)=>{console.error("Server Error:",err);res.status(500).send("Internal Server Error");});
app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));module.exports=app;