const { buildSchema } = require("graphql");
const Blog = require("../models/Blog");
const User = require("../models/user");
const mongoose = require("mongoose");

const schema = buildSchema(`
  type User {
    _id: ID
    fullName: String
    profileImageURL: String
    role: String
  }

  type Blog {
    _id: ID
    title: String
    body: String
    coverImageURL: String
    createdAt: String
    createdBy: User
  }

  type Query {
    blogs(search: String, sort: String, page: Int = 1, limit: Int = 9): [Blog]
    blog(id: ID!): Blog
    me: User
  }
`);

function safePagination(page, limit) {
  const safePage = Math.min(Math.max(Number.isInteger(page) ? page : 1, 1), 100000);
  const safeLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 9, 1), 50);
  return { page: safePage, limit: safeLimit };
}

async function canAccessBlog(blog, viewerId) {
  if (!blog) return false;
  const author = await User.findById(blog.createdBy).select("isPrivate followers").lean();
  if (!author || !author.isPrivate) return true;
  if (!viewerId) return false;
  return author._id.toString() === viewerId.toString() ||
    author.followers.some(id => id.toString() === viewerId.toString());
}

const root = {
  blogs: async ({ search, sort = "newest", page = 1, limit = 9 }, context) => {
    try {
      const { page: safePage, limit: safeLimit } = safePagination(page, limit);
      const viewerId = context?.user?._id;
      const privateUsers = await User.find({ isPrivate: true }).select("_id followers").lean();
      const privateIds = privateUsers.map(u => u._id);
      const followedPrivate = viewerId
        ? privateUsers.filter(u => u.followers.some(id => id.toString() === viewerId.toString())).map(u => u._id)
        : [];

      const visibility = {
        $or: [
          { createdBy: { $nin: privateIds } },
          { createdBy: { $in: followedPrivate } },
          ...(viewerId ? [{ createdBy: viewerId }] : [])
        ]
      };

      const filter = { isDeleted: false, status: "published", ...visibility };
      if (typeof search === "string" && search.trim()) {
        const escaped = search.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filter.$and = [
          visibility,
          { $or: [{ title: { $regex: escaped, $options: "i" } }, { body: { $regex: escaped, $options: "i" } }] }
        ];
      }

      const sortOption = sort === "oldest" ? { createdAt: 1 } : sort === "title" ? { title: 1 } : { createdAt: -1 };
      const blogs = await Blog.find(filter)
        .sort(sortOption)
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .populate("createdBy", "fullName profileImageURL")
        .lean();
      return blogs;
    } catch (error) {
      console.error("GraphQL blogs error:", error);
      return [];
    }
  },

  blog: async ({ id }, context) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) return null;
      const blog = await Blog.findOne({ _id: id, isDeleted: false, status: "published" })
        .populate("createdBy", "fullName profileImageURL")
        .lean();
      if (!(await canAccessBlog(blog, context?.user?._id))) return null;
      return blog;
    } catch (error) {
      console.error("GraphQL blog error:", error);
      return null;
    }
  },

  me: (args, context) => context?.user || null
};

module.exports = { schema, root };
