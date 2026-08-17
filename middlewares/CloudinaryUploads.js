const multer = require('multer');
const cloudinary = require('cloudinary').v2;

// Keep files in memory. Profile and blog routes upload the buffer explicitly to Cloudinary.
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

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

function uploadBuffer(buffer, options = {}) {
    if (!buffer || !Buffer.isBuffer(buffer)) {
        return Promise.reject(new Error('No image data received'));
    }
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        return Promise.reject(new Error('Image upload is not configured on the server'));
    }

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
