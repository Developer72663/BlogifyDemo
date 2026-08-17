const multer = require('multer');
const cloudinary = require('cloudinary').v2;

// Blogify deployments may use either the legacy names or the CLOUDINARY_* names.
const getCloudinaryConfig = () => ({
    cloud_name: process.env.CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME,
    api_key: process.env.API_KEY || process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_KEY,
    api_secret: process.env.API_SECRET || process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_SECRET || process.env.CLOUDINARY_SECRET_KEY
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

    const config = getCloudinaryConfig();
    if (!config.cloud_name || !config.api_key || !config.api_secret) {
        return Promise.reject(new Error('Image upload is not configured on the server. Set CLOUD_NAME, API_KEY and API_SECRET.'));
    }

    cloudinary.config(config);

    return new Promise((resolve, reject) => {
        // Do not use format: 'auto' here. Cloudinary can interpret it as an
        // extension in this upload path and return "Invalid extension in
        // transformation: auto". Cloudinary will preserve the uploaded image
        // format unless an explicit format is requested.
        const uploadOptions = {
            folder: options.folder || 'blogify_uploads',
            resource_type: 'image',
            transformation: options.transformation || [{ width: 1600, height: 1000, crop: 'limit' }]
        };

        // Only copy supported explicit options; never let a caller reintroduce
        // format:auto through the default upload path.
        if (options.public_id) uploadOptions.public_id = options.public_id;
        if (options.overwrite !== undefined) uploadOptions.overwrite = options.overwrite;
        if (options.tags) uploadOptions.tags = options.tags;
        if (options.context) uploadOptions.context = options.context;
        if (options.format && options.format !== 'auto') uploadOptions.format = options.format;

        const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
            if (error) return reject(error);
            if (!result || !result.secure_url) return reject(new Error('Cloudinary did not return an image URL'));
            resolve(result);
        });
        stream.on('error', reject);
        stream.end(buffer);
    });
}

cloudinaryUpload.uploadBuffer = uploadBuffer;
module.exports = cloudinaryUpload;
