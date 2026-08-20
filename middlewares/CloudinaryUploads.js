const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const getCloudinaryConfig = () => ({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

function configureCloudinary(type) {
    const config = getCloudinaryConfig();
    if (!config.cloud_name || !config.api_key || !config.api_secret) {
        throw new Error(`${type} upload is not configured on the server. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.`);
    }
    cloudinary.config(config);
}

const imageFilter = (req, file, cb) => {
    if (!file || typeof file.mimetype !== 'string' || !file.mimetype.startsWith('image/')) {
        const error = new Error('Only image files are allowed'); error.code = 'INVALID_IMAGE_TYPE'; return cb(error);
    }
    cb(null, true);
};

const mediaFilter = (req, file, cb) => {
    if (!file || typeof file.mimetype !== 'string' || (!file.mimetype.startsWith('image/') && !file.mimetype.startsWith('video/'))) {
        const error = new Error('Only image or video files are allowed'); error.code = 'INVALID_MEDIA_TYPE'; return cb(error);
    }
    cb(null, true);
};

const cloudinaryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: imageFilter
});

const mediaUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: mediaFilter
});

function uploadStream(buffer, uploadOptions, timeoutMs, missingMessage) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn(value);
        };
        const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
            if (error) return finish(reject, error);
            if (!result?.secure_url) return finish(reject, new Error(missingMessage));
            finish(resolve, result);
        });
        stream.on('error', error => finish(reject, error));
        const timer = setTimeout(() => {
            try { stream.destroy(new Error('Cloudinary upload timed out. Please try a smaller file or try again.')); } catch (_) {}
            finish(reject, new Error('Cloudinary upload timed out. Please try again.'));
        }, timeoutMs);
        stream.end(buffer);
    });
}

function uploadBuffer(buffer, options = {}) {
    if (!buffer || !Buffer.isBuffer(buffer)) return Promise.reject(new Error('No image data received'));
    try { configureCloudinary('Image'); } catch (e) { return Promise.reject(e); }
    const uploadOptions = {
        folder: options.folder || 'blogify_uploads',
        resource_type: 'image',
        transformation: options.transformation || [{ width: 1600, height: 1000, crop: 'limit' }]
    };
    if (options.public_id) uploadOptions.public_id = options.public_id;
    if (options.overwrite !== undefined) uploadOptions.overwrite = options.overwrite;
    if (options.tags) uploadOptions.tags = options.tags;
    if (options.context) uploadOptions.context = options.context;
    if (options.format && options.format !== 'auto') uploadOptions.format = options.format;
    return uploadStream(buffer, uploadOptions, 25000, 'Cloudinary did not return an image URL');
}

async function uploadVideoBuffer(buffer, options = {}) {
    if (!buffer || !Buffer.isBuffer(buffer)) throw new Error('No video data received');
    configureCloudinary('Video');
    const uploadOptions = {
        folder: options.folder || 'blogify_videos',
        resource_type: 'video',
        eager: [{ duration: 60, format: 'mp4' }],
        eager_async: false
    };
    if (options.public_id) uploadOptions.public_id = options.public_id;
    const result = await uploadStream(buffer, uploadOptions, 120000, 'Cloudinary did not return the processed video URL');
    const trimmed = result?.eager?.[0]?.secure_url;
    if (!trimmed) throw new Error('Cloudinary did not return the trimmed video URL');
    return { ...result, secure_url: trimmed, original_secure_url: result.secure_url, durationLimit: 60 };
}

cloudinaryUpload.uploadBuffer = uploadBuffer;
cloudinaryUpload.mediaUpload = mediaUpload;
cloudinaryUpload.uploadVideoBuffer = uploadVideoBuffer;
module.exports = cloudinaryUpload;
