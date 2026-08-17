const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const getCloudinaryConfig = () => ({
    cloud_name: process.env.CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME,
    api_key: process.env.API_KEY || process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_KEY,
    api_secret: process.env.API_SECRET || process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_SECRET || process.env.CLOUDINARY_SECRET_KEY
});

function configureCloudinary(type) {
    const config = getCloudinaryConfig();
    if (!config.cloud_name || !config.api_key || !config.api_secret) {
        throw new Error(`${type} upload is not configured on the server. Set CLOUD_NAME, API_KEY and API_SECRET.`);
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

const cloudinaryUpload = multer({storage: multer.memoryStorage(),limits: {fileSize: 10 * 1024 * 1024},fileFilter: imageFilter});
const mediaUpload = multer({storage: multer.memoryStorage(),limits: {fileSize: 100 * 1024 * 1024},fileFilter: mediaFilter});

function uploadBuffer(buffer, options = {}) {
    if (!buffer || !Buffer.isBuffer(buffer)) return Promise.reject(new Error('No image data received'));
    try { configureCloudinary('Image'); } catch (e) { return Promise.reject(e); }
    return new Promise((resolve, reject) => {
        const uploadOptions = {folder: options.folder || 'blogify_uploads',resource_type: 'image',transformation: options.transformation || [{width:1600,height:1000,crop:'limit'}]};
        if (options.public_id) uploadOptions.public_id = options.public_id;
        if (options.overwrite !== undefined) uploadOptions.overwrite = options.overwrite;
        if (options.tags) uploadOptions.tags = options.tags;
        if (options.context) uploadOptions.context = options.context;
        if (options.format && options.format !== 'auto') uploadOptions.format = options.format;
        const stream = cloudinary.uploader.upload_stream(uploadOptions,(error,result)=>{if(error)return reject(error);if(!result?.secure_url)return reject(new Error('Cloudinary did not return an image URL'));resolve(result);});
        stream.on('error',reject);stream.end(buffer);
    });
}

async function uploadVideoBuffer(buffer, options = {}) {
    if (!buffer || !Buffer.isBuffer(buffer)) throw new Error('No video data received');
    configureCloudinary('Video');
    return new Promise((resolve,reject)=>{
        const uploadOptions={folder:options.folder||'blogify_videos',resource_type:'video',eager:[{duration:60,format:'mp4'}],eager_async:false};
        if(options.public_id)uploadOptions.public_id=options.public_id;
        const stream=cloudinary.uploader.upload_stream(uploadOptions,(error,result)=>{
            if(error)return reject(error);
            const trimmed=result?.eager?.[0]?.secure_url;
            if(!trimmed)return reject(new Error('Cloudinary did not return the trimmed video URL'));
            resolve({...result,secure_url:trimmed,original_secure_url:result.secure_url,durationLimit:60});
        });
        stream.on('error',reject);stream.end(buffer);
    });
}

cloudinaryUpload.uploadBuffer=uploadBuffer;
cloudinaryUpload.mediaUpload=mediaUpload;
cloudinaryUpload.uploadVideoBuffer=uploadVideoBuffer;
module.exports=cloudinaryUpload;
