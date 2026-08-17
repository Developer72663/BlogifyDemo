const multer = require('multer');

// Avatar uploads are kept in memory and sent to Cloudinary explicitly by the profile route.
// This avoids CloudinaryStorage/multer adapter errors and lets the route always return JSON.
const cloudinaryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (req, file, cb) => {
        if (!file || typeof file.mimetype !== 'string' || !file.mimetype.startsWith('image/')) {
            const error = new Error('Only image files are allowed for profile avatars');
            error.code = 'INVALID_IMAGE_TYPE';
            return cb(error);
        }
        cb(null, true);
    },
});

module.exports = cloudinaryUpload;
