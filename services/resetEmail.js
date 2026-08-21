const nodemailer = require('nodemailer');
require('dotenv').config();

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeUrl(value = '') {
    try {
        const url = new URL(String(value));
        if (url.protocol === 'https:' || url.protocol === 'http:') {
            return escapeHtml(url.toString());
        }
    } catch (_) {
        // Invalid URLs are rejected below.
    }
    return null;
}

function getSmtpConfig() {
    const user = (process.env.EMAIL_USER || '').trim();
    const password = (process.env.EMAIL_PASSWORD || '').replace(/\s+/g, '');

    if (!user || !password) {
        throw new Error('Email service is not configured');
    }

    const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
    const port = Number(process.env.SMTP_PORT || (host === 'smtp.gmail.com' ? 465 : 587));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Invalid SMTP_PORT configuration');
    }

    const secure = process.env.SMTP_SECURE != null
        ? String(process.env.SMTP_SECURE).toLowerCase() === 'true'
        : port === 465;

    return { user, password, host, port, secure };
}

function createTransporter(config) {
    return nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: config.password
        },
        requireTLS: !config.secure,
        connectionTimeout: 12000,
        greetingTimeout: 12000,
        socketTimeout: 20000,
        tls: {
            minVersion: 'TLSv1.2'
        }
    });
}

async function sendWithConfig(mailOptions, config) {
    const transporter = createTransporter(config);
    try {
        return await transporter.sendMail(mailOptions);
    } finally {
        transporter.close();
    }
}

async function sendResetPasswordEmail(email, resetLink) {
    if (!email || !resetLink) {
        throw new Error('Reset email requires a recipient and reset link');
    }

    const safeResetLink = safeUrl(resetLink);
    if (!safeResetLink) {
        throw new Error('Invalid reset link');
    }

    const smtp = getSmtpConfig();
    const mailOptions = {
        from: process.env.EMAIL_FROM || smtp.user,
        to: email,
        subject: 'Reset Your Blogify Password',
        text: `We received a request to reset your Blogify password. Use this link within 30 minutes: ${resetLink}\n\nIf you did not request this, you can ignore this email.`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;background:#f5f7ff">
                <div style="background:#fff;border-radius:12px;padding:30px">
                    <h2 style="color:#667eea;text-align:center">Password Reset Request</h2>
                    <p style="color:#555;line-height:1.6">We received a request to reset your Blogify password.</p>
                    <div style="text-align:center;margin:28px 0">
                        <a href="${safeResetLink}" style="display:inline-block;background:#667eea;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold">Reset Password</a>
                    </div>
                    <p style="color:#777;font-size:13px">Or copy this link into your browser:</p>
                    <p style="word-break:break-all;background:#f5f5f5;padding:12px;border-radius:6px;font-size:12px">${safeResetLink}</p>
                    <p style="color:#d9534f;font-weight:bold;font-size:13px">This link expires in 30 minutes.</p>
                    <hr style="border:0;border-top:1px solid #eee;margin:24px 0">
                    <p style="color:#999;font-size:12px">If you did not request this, you can safely ignore this email.</p>
                </div>
            </div>
        `
    };

    try {
        await sendWithConfig(mailOptions, smtp);
        return { success: true, message: 'Reset link sent successfully' };
    } catch (firstError) {
        // Gmail's implicit TLS endpoint is used only when no explicit SMTP
        // transport was configured. This keeps custom SMTP deployments intact.
        const isDefaultGmailConfig = smtp.host === 'smtp.gmail.com' && !process.env.SMTP_PORT && !process.env.SMTP_SECURE;
        if (!isDefaultGmailConfig) {
            console.error(`Password reset email failed: ${firstError.code || 'SMTP_ERROR'} ${firstError.message}`);
            throw firstError;
        }

        const fallback = { ...smtp, port: 465, secure: true };
        try {
            await sendWithConfig(mailOptions, fallback);
            return { success: true, message: 'Reset link sent successfully' };
        } catch (fallbackError) {
            console.error(`Password reset email failed on SMTP fallback: ${fallbackError.code || 'SMTP_ERROR'} ${fallbackError.message}`);
            const combined = new Error(`Unable to send reset email: ${fallbackError.message}`);
            combined.code = fallbackError.code || firstError.code;
            throw combined;
        }
    }
}

module.exports = { sendResetPasswordEmail };
