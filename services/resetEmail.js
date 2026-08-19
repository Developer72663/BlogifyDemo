const nodemailer = require('nodemailer');
require('dotenv').config();

function createTransporter() {
    const user = process.env.EMAIL_USER;
    const password = (process.env.EMAIL_PASSWORD || '').replace(/\s+/g, '');

    if (!user || !password) {
        throw new Error('EMAIL_USER or EMAIL_PASSWORD is not configured');
    }

    // Explicit SMTP configuration is more predictable on Vercel/serverless
    // than a pooled service transport that keeps sockets between invocations.
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT || 465),
        secure: process.env.SMTP_SECURE
            ? String(process.env.SMTP_SECURE).toLowerCase() === 'true'
            : true,
        auth: {
            user,
            pass: password
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
    });
}

async function sendResetPasswordEmail(email, resetLink) {
    if (!email || !resetLink) {
        throw new Error('Reset email requires a recipient and reset link');
    }

    const transporter = createTransporter();

    try {
        await transporter.sendMail({
            from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
            to: email,
            subject: 'Reset Your Blogify Password',
            text: `We received a request to reset your Blogify password. Use this link within 30 minutes: ${resetLink}\n\nIf you did not request this, you can ignore this email.`,
            html: `
                <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;background:#f5f7ff">
                    <div style="background:#fff;border-radius:12px;padding:30px">
                        <h2 style="color:#667eea;text-align:center">Password Reset Request</h2>
                        <p style="color:#555;line-height:1.6">We received a request to reset your Blogify password.</p>
                        <div style="text-align:center;margin:28px 0">
                            <a href="${resetLink}" style="display:inline-block;background:#667eea;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold">Reset Password</a>
                        </div>
                        <p style="color:#777;font-size:13px">Or copy this link into your browser:</p>
                        <p style="word-break:break-all;background:#f5f5f5;padding:12px;border-radius:6px;font-size:12px">${resetLink}</p>
                        <p style="color:#d9534f;font-weight:bold;font-size:13px">This link expires in 30 minutes.</p>
                        <hr style="border:0;border-top:1px solid #eee;margin:24px 0">
                        <p style="color:#999;font-size:12px">If you did not request this, you can safely ignore this email.</p>
                    </div>
                </div>
            `
        });
        return { success: true, message: 'Reset link sent successfully' };
    } finally {
        transporter.close();
    }
}

module.exports = { sendResetPasswordEmail };
