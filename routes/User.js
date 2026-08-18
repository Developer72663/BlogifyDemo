const express = require('express');
const router = express.Router();
const User = require('../models/user');
const { sendOTPEmail, sendResetPasswordEmail } = require('../services/email');
const { creatTokenForUser } = require('../services/authentication');
const crypto = require('crypto');
const { loginLimiter, otpLimiter } = require('../middlewares/rateLimiting');
const { validateEmail } = require('../middlewares/validation');

// In-memory stores (for production, use Redis or database)
const otpStore = new Map();
const resetTokens = new Map();

// Development-only email test endpoint. Never expose it in production.
router.post('/test-email', async (req, res) => {
    if (process.env.NODE_ENV === 'production' || !process.env.TEST_EMAIL_SECRET || req.get('x-test-email-secret') !== process.env.TEST_EMAIL_SECRET) {
        return res.status(404).json({ success: false, message: 'Not found' });
    }
    const { email } = req.body;
    if (!email || !validateEmail(email)) return res.status(400).json({ success: false, message: 'Valid email is required' });
    try {
        await sendOTPEmail(email.toLowerCase().trim(), crypto.randomInt(100000, 1000000).toString());
        return res.json({ success: true, message: 'Test email sent' });
    } catch (error) {
        console.error('Test email failed:', error.message);
        return res.status(500).json({ success: false, message: 'Email test failed' });
    }
});

router.get('/signin', (req, res) => {
    if (req.user) return res.redirect('/');
    res.render('signin', { error: null });
});

router.post('/signin', loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    try {
        if (!email || !password || !validateEmail(email)) return res.status(400).json({ success: false, message: 'Invalid email or password' });
        const token = await User.matchPassword(email.toLowerCase().trim(), password);
        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.status(200).json({ success: true, message: 'Login successful', redirect: '/' });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
});

router.get('/logout', (req, res) => { res.clearCookie('token'); res.redirect('/'); });
router.post('/logout', (req, res) => { res.clearCookie('token'); res.status(200).json({ success: true, message: 'Logged out successfully' }); });

router.get('/signup', (req, res) => {
    if (req.user) return res.redirect('/');
    res.render('signup', { error: null });
});

router.post('/send-otp', otpLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email || !validateEmail(email)) return res.status(400).json({ success: false, message: 'Valid email is required' });
    try {
        const normalizedEmail = email.toLowerCase().trim();
        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) return res.status(409).json({ success: false, message: 'Email already registered. Please login instead.' });
        const otp = crypto.randomInt(100000, 1000000).toString();
        otpStore.set(normalizedEmail, { otp, expires: Date.now() + 5 * 60 * 1000, attempts: 0 });
        try {
            await sendOTPEmail(normalizedEmail, otp);
        } catch (emailError) {
            otpStore.delete(normalizedEmail);
            console.error('OTP email error:', emailError.message);
            return res.status(500).json({ success: false, message: 'Unable to send OTP. Please try again.' });
        }
        res.json({ success: true, message: 'OTP sent successfully to your email. It will expire in 5 minutes.' });
    } catch (error) {
        console.error('Send OTP Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to send OTP. Please try again.' });
    }
});

router.post('/signup', loginLimiter, async (req, res) => {
    const { fullName, email, password, otp } = req.body;
    if (!fullName || !email || !password || !otp) return res.status(400).json({ success: false, message: 'All fields are required' });
    try {
        const normalizedEmail = email.toLowerCase().trim();
        if (!validateEmail(normalizedEmail)) return res.status(400).json({ success: false, message: 'Invalid email format' });
        if (password.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
        if (!/^\d{6}$/.test(String(otp))) return res.status(400).json({ success: false, message: 'Invalid OTP' });
        const stored = otpStore.get(normalizedEmail);
        if (!stored || stored.expires < Date.now()) {
            otpStore.delete(normalizedEmail);
            return res.status(400).json({ success: false, message: 'OTP has expired or is invalid. Please request a new one.' });
        }
        if (stored.attempts >= 5) {
            otpStore.delete(normalizedEmail);
            return res.status(429).json({ success: false, message: 'Too many invalid OTP attempts. Please request a new OTP.' });
        }
        if (stored.otp !== String(otp)) {
            stored.attempts += 1;
            return res.status(400).json({ success: false, message: 'Invalid OTP' });
        }
        if (await User.findOne({ email: normalizedEmail })) return res.status(409).json({ success: false, message: 'Email already registered. Please login instead.' });
        const user = await User.create({ fullName: String(fullName).trim().slice(0, 100), email: normalizedEmail, password });
        otpStore.delete(normalizedEmail);
        const token = creatTokenForUser(user);
        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.json({ success: true, message: 'Account created successfully!', redirect: '/' });
    } catch (error) {
        console.error('Signup Error:', error.message);
        res.status(500).json({ success: false, message: 'Signup failed. Please try again.' });
    }
});

router.post('/forgot-password', loginLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email || !validateEmail(email)) return res.status(400).json({ success: false, message: 'Valid email is required' });
    try {
        const normalizedEmail = email.toLowerCase().trim();
        const user = await User.findOne({ email: normalizedEmail });
        if (!user) return res.status(200).json({ success: true, message: 'If this email exists, a password reset link has been sent' });
        const resetToken = crypto.randomBytes(32).toString('hex');
        resetTokens.set(resetToken, { email: normalizedEmail, expires: Date.now() + 30 * 60 * 1000 });
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const configuredBase = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
        const baseUrl = configuredBase ? configuredBase.replace(/\/$/, '') : `${protocol}://${host}`;
        const resetLink = `${baseUrl}/user/reset-password?token=${encodeURIComponent(resetToken)}`;
        try {
            await sendResetPasswordEmail(normalizedEmail, resetLink);
        } catch (emailError) {
            resetTokens.delete(resetToken);
            console.error('Reset email failed:', emailError.message);
            return res.status(500).json({ success: false, message: 'Unable to send reset email. Please try again.' });
        }
        res.json({ success: true, message: 'If this email exists, a password reset link has been sent' });
    } catch (error) {
        console.error('Forgot Password Error:', error.message);
        res.status(500).json({ success: false, message: 'Unable to process password reset request.' });
    }
});

router.get('/reset-password', (req, res) => {
    const { token } = req.query;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(400).render('404', { message: 'Invalid reset link' });
    const stored = resetTokens.get(token);
    if (!stored) return res.status(400).render('404', { message: 'Reset link not found. Please request a new one.' });
    if (stored.expires < Date.now()) {
        resetTokens.delete(token);
        return res.status(400).render('404', { message: 'Reset link has expired. Please request a new one.' });
    }
    res.render('reset-password', { token, error: null });
});

router.post('/reset-password', loginLimiter, async (req, res) => {
    const { token, newPassword, confirmPassword } = req.body;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || !newPassword || !confirmPassword) return res.status(400).json({ success: false, message: 'Invalid reset request' });
    if (newPassword !== confirmPassword) return res.status(400).json({ success: false, message: 'Passwords do not match' });
    if (newPassword.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    try {
        const stored = resetTokens.get(token);
        if (!stored || stored.expires < Date.now()) {
            resetTokens.delete(token);
            return res.status(400).json({ success: false, message: 'Reset link is invalid or expired' });
        }
        const user = await User.findOne({ email: stored.email });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        user.password = newPassword;
        await user.save();
        resetTokens.delete(token);
        res.json({ success: true, message: 'Password reset successfully. Redirecting to login...', redirect: '/user/signin' });
    } catch (error) {
        console.error('Reset Password Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to reset password' });
    }
});

setInterval(() => {
    const now = Date.now();
    for (const [email, data] of otpStore.entries()) if (data.expires < now) otpStore.delete(email);
    for (const [token, data] of resetTokens.entries()) if (data.expires < now) resetTokens.delete(token);
}, 5 * 60 * 1000);

module.exports = router;
