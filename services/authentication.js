const jwt = require("jsonwebtoken");
require("dotenv").config();

// Read the secret lazily instead of throwing while the Vercel function module
// is being loaded. A missing secret must still make JWT operations fail, but
// it should not crash the entire serverless function before Express can
// handle the request and return a useful error.
const getJwtSecret = () => {
    const secret = typeof process.env.JWT_SECRET === "string"
        ? process.env.JWT_SECRET.trim()
        : "";

    if (!secret || secret.length < 32) {
        throw new Error("JWT_SECRET must be configured in the deployment environment and contain at least 32 characters.");
    }

    return secret;
};

// Create Token
const creatTokenForUser = (user) => {
    const payload = {
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        profileImageURL: user.profileImageURL,
        role: user.role,
        googleId: user.googleId
    };

    return jwt.sign(payload, getJwtSecret(), {
        expiresIn: "7d",
        algorithm: "HS256"
    });
};

// Verify Token. Explicitly restrict the accepted algorithm so a token using
// an unexpected JWT algorithm cannot be accepted accidentally.
const verifyToken = (token) => {
    return jwt.verify(token, getJwtSecret(), {
        algorithms: ["HS256"]
    });
};

module.exports = {
    creatTokenForUser,
    verifyToken
};
