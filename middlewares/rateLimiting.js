const rateLimit = require('express-rate-limit');
const { Redis } = require('@upstash/redis');
const { Ratelimit } = require('@upstash/ratelimit');

const limiterMessage = 'Too many requests, please try again later';
const hasUpstash = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
let redis = null;
if (hasUpstash) redis = Redis.fromEnv();

function createDistributedLimiter(name, limit, duration, keyFn) {
    if (!redis) {
        if (process.env.NODE_ENV === 'production') {
            console.warn(`[rate-limit] ${name} is using process-local fallback. Configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for distributed protection.`);
        }
        return rateLimit({ windowMs: duration, max: limit, standardHeaders: true, legacyHeaders: false, keyGenerator: keyFn, message: limiterMessage });
    }

    const limiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, `${Math.round(duration / 1000)} s`),
        prefix: `blogify:${name}`,
        analytics: false,
    });

    return async (req, res, next) => {
        try {
            const result = await limiter.limit(keyFn(req));
            res.setHeader('RateLimit-Limit', String(result.limit));
            res.setHeader('RateLimit-Remaining', String(Math.max(0, result.remaining)));
            res.setHeader('RateLimit-Reset', String(Math.ceil(result.reset / 1000)));
            if (!result.success) return res.status(429).json({ success: false, message: limiterMessage });
            return next();
        } catch (error) {
            // Availability is preferable to taking the entire application down
            // when Redis is temporarily unavailable. Monitoring should alert on this.
            console.error(`[rate-limit] ${name} failed:`, error.message);
            return next();
        }
    };
}

const identityKey = (req) => req.user?._id?.toString() || req.ip;
const ipKey = (req) => req.ip;

const loginLimiter = createDistributedLimiter('login', 5, 15 * 60 * 1000, ipKey);
const otpLimiter = createDistributedLimiter('otp', 3, 10 * 60 * 1000, ipKey);
const apiLimiter = createDistributedLimiter('api', 100, 15 * 60 * 1000, ipKey);
const actionLimiter = createDistributedLimiter('action', 300, 15 * 60 * 1000, identityKey);
const blogCreationLimiter = createDistributedLimiter('blog-create', 20, 60 * 60 * 1000, identityKey);

module.exports = { loginLimiter, otpLimiter, apiLimiter, actionLimiter, blogCreationLimiter };
