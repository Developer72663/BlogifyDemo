const validateEmail = (email) => {
    if (typeof email !== "string") return false;
    const normalized = email.trim();
    return normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
};

const validatePassword = (password) => {
    return typeof password === "string" && password.length >= 8 && password.length <= 256;
};

const sanitizeInput = (input) => {
    if (typeof input !== 'string') return input;
    return input.replace(/[<>]/g, '').trim().substring(0, 5000);
};

const validateBlog = (title, body, tags = []) => {
    const errors = [];
    if (typeof title !== 'string' || title.trim().length === 0) errors.push("Title is required");
    else if (title.length > 200) errors.push("Title must be less than 200 characters");
    if (typeof body !== 'string' || body.trim().length === 0) errors.push("Content is required");
    else if (body.length > 50000) errors.push("Content is too long (max 50000 characters)");
    if (!Array.isArray(tags) || tags.length > 10) errors.push("Maximum 10 tags allowed");
    return { isValid: errors.length === 0, errors };
};

const validateComment = (content) => {
    const errors = [];
    if (typeof content !== 'string' || content.trim().length === 0) errors.push("Comment cannot be empty");
    else if (content.length > 5000) errors.push("Comment is too long (max 5000 characters)");
    return { isValid: errors.length === 0, errors };
};

module.exports = { validateEmail, validatePassword, sanitizeInput, validateBlog, validateComment };
