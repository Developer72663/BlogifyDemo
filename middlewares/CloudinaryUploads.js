const multer = require('multer');
const cloudinary = require('cloudinary').v2;

// Accept both the current Blogify names and the common/legacy names used by
// older Blogify deployments. This lets existing deployment variables work
// without requiring users to rename their secrets.
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME || process.env.CLOUDINARY_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY || process.env.API_KEY || process.env.CLOUDINARY_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET || process.env.API_SECRET || process.env.CLOUDINARY_SECRET || process.env.CLOUDINARY_SECRET_KEY;

cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: API_KEY,
    api_secret: API_SECRET
});

const cloudinaryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file || typeof file.mimetype !== 'string' || !file.mimetype.startsWith('image/')) {
            const error = new Error('Only image files are allowed');
            error.code = 'INVALID_IMAGE_TYPE';
            return cb(error);
        }
        cb(null, true);
    }
});

function uploadBuffer(buffer, options = {}) {
    if (!buffer || !Buffer.isBuffer(buffer)) {
        return Promise.reject(new Error('No image data received'));
    }

    // Resolve env values at upload time as well, which is safer for hosting
    // platforms that inject environment variables during application startup.
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME || process.env.CLOUDINARY_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY || process.env.API_KEY || process.env.CLOUDINARY_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.API_SECRET || process.env.CLOUDINARY_SECRET || process.env.CLOUDINARY_SECRET_KEY;

    if (!cloudName || !apiKey || !apiSecret) {
        return Promise.reject(new Error('Image upload is not configured on the server. Set CLOUDINARY_CLOUD_NAME/CLOUD_NAME, CLOUDINARY_API_KEY/API_KEY and CLOUDINARY_API_SECRET/API_SECRET.'));
    }

    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({
            folder: options.folder || 'blogify_uploads',
            resource_type: 'image',
            transformation: options.transformation || [{ width: 1600, height: 1000, crop: 'limit' }],
            format: 'auto',
            ...options
        }, (error, result) => error ? reject(error) : resolve(result));
        stream.end(buffer);
    });
}

cloudinaryUpload.uploadBuffer = uploadBuffer;
module.exports = cloudinaryUpload;
