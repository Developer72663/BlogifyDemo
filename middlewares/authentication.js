// middlewares/authentication.js
const { verifyToken } = require("../services/authentication");
const User = require("../models/user");

const checkForAuthenticationCookie = (cookieName) => {
    return async (req, res, next) => {
        const token = req.cookies[cookieName];
        if (!token) {
            req.user = null;
            return next();
        }

        try {
            const tokenUser = verifyToken(token);

            // The JWT contains a snapshot of the user's profile. After an
            // avatar/profile update that snapshot can be stale, so always
            // refresh the user from MongoDB before rendering pages.
            const currentUser = await User.findById(tokenUser._id).lean();

            if (!currentUser) {
                req.user = null;
                return next();
            }

            req.user = currentUser;
        } catch (error) {
            console.error("Authentication lookup failed:", error.message);
            req.user = null;
        }
        next();
    };
};

// Restrict to Logged-in Users Only
const restrictToLoggedInUserOnly = (req, res, next) => {
    if (!req.user) {
        return res.redirect("/user/signin");
    }
    next();
};

// Restrict to Admin Only
const restrictTo = (roles = []) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.redirect("/user/signin");
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).send("Access Denied: Admins Only");
        }
        next();
    };
};

module.exports = {
    checkForAuthenticationCookie,
    restrictTo,
    restrictToLoggedInUserOnly
};
