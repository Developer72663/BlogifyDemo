const rateLimit = require('express-rate-limit');

const limiterMessage = 'Too many requests, please try again later';

// Login attempt limiter
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: limiterMessage,
});

// OTP request limiter
const otpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: limiterMessage,
});

// General API limiter
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: limiterMessage,
});

// Authenticated write/action limiter. This helps prevent spam against
// routes such as follow, comment, notification, safety and messaging APIs.
const actionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?._id?.toString() || req.ip,
    message: limiterMessage,
});

// Blog creation limiter (per user)
const blogCreationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    keyGenerator: (req) => req.user?._id?.toString() || req.ip,
    skip: (req) => !req.user,
    message: 'You are creating blogs too quickly, please slow down',
});

module.exports = {
    loginLimiter,
    otpLimiter,
    apiLimiter,
    actionLimiter,
    blogCreationLimiter
};
