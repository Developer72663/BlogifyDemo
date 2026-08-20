require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await mongoose.connect(process.env.MONGODB_URI);
    const Blog = mongoose.model('blog', new mongoose.Schema({}, { strict: false, collection: 'blogs' }));
    const result = await Blog.updateMany({ viewers: { $exists: true } }, { $unset: { viewers: 1 } });
    console.log(`Removed legacy embedded viewers from ${result.modifiedCount} blog documents.`);
    await mongoose.disconnect();
}

run().catch(async (error) => { console.error(error); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
