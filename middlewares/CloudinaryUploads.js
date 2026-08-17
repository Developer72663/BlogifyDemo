const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const dotenv = require('dotenv');

dotenv.config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Accept common photo formats. Cloudinary handles the actual image conversion/storage.
// The fileFilter also prevents non-image files from reaching Cloudinary.
const storage = new CloudinaryStorage({
    cloudinary,
    params: {
        folder: 'blogifyer_uploads',
        allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'avif'],
        transformation: [{ width: 800, height: 800, crop: 'limit' }],
    },
});

const cloudinaryUpload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB maximum avatar size
    fileFilter: (req, file, cb) => {
        if (file && typeof file.mimetype === 'string' && file.mimetype.startsWith('image/')) {
            return cb(null, true);
        }
        const error = new Error('Only image files are allowed for profile avatars');
        error.code = 'INVALID_IMAGE_TYPE';
        return cb(error);
    },
});

module.exports = cloudinaryUpload;
