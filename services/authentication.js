const jwt = require("jsonwebtoken");
require("dotenv").config();

// Never fall back to a predictable JWT secret. A fallback secret would allow
// anyone who knows the default value to forge authentication tokens.
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be configured and contain at least 32 characters.");
}

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

    return jwt.sign(payload, JWT_SECRET, {
        expiresIn: "7d",
        algorithm: "HS256"
    });
};

// Verify Token. Explicitly restrict the accepted algorithm so a token using
// an unexpected JWT algorithm cannot be accepted accidentally.
const verifyToken = (token) => {
    return jwt.verify(token, JWT_SECRET, {
        algorithms: ["HS256"]
    });
};

module.exports = {
    creatTokenForUser,
    verifyToken
};
