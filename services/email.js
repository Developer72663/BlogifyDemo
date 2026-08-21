const nodemailer = require('nodemailer');
require('dotenv').config();

/**
 * Escape values before placing application data into email HTML.
 * This prevents user-controlled names/comments/titles from becoming HTML.
 */
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
        // Invalid URLs are never placed into href/src attributes.
    }
    return '#';
}

function getEmailConfig() {
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

function createTransporter() {
    const config = getEmailConfig();

    return nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: config.password
        },
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        rateDelta: 1000,
        rateLimit: 5,
        connectionTimeout: 12000,
        greetingTimeout: 12000,
        socketTimeout: 20000,
        requireTLS: !config.secure,
        tls: {
            minVersion: 'TLSv1.2'
        }
    });
}

// One pooled transporter for the process. Credentials are never logged.
let transporter;
function getTransporter() {
    if (!transporter) {
        transporter = createTransporter();
    }
    return transporter;
}

function fromAddress() {
    const config = getEmailConfig();
    return process.env.EMAIL_FROM || config.user;
}

async function send(mailOptions) {
    try {
        return await getTransporter().sendMail({
            ...mailOptions,
            from: mailOptions.from || fromAddress()
        });
    } catch (error) {
        // Do not log recipient, OTP, reset tokens, credentials, or full error objects.
        console.error(`Email send failed: ${error.code || 'SMTP_ERROR'} ${error.message}`);
        throw error;
    }
}

const sendOTPEmail = async (email, otp) => {
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        throw new Error('Invalid email address');
    }
    if (!/^\d{6}$/.test(String(otp))) {
        throw new Error('Invalid OTP');
    }

    const safeOtp = escapeHtml(otp);
    const mailOptions = {
        to: email,
        subject: 'Your Signup OTP - Blogify',
        text: `Your Blogify signup verification code is ${otp}. It expires in 5 minutes. If you did not request this, ignore this email.`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:20px;background:#667eea">
                <div style="background:#fff;border-radius:10px;padding:30px;text-align:center">
                    <h2 style="color:#667eea">Verify Your Email</h2>
                    <p style="color:#666">Use this code to complete your signup:</p>
                    <div style="background:#f5f5f5;border:3px dashed #667eea;border-radius:8px;padding:25px;margin:20px 0">
                        <h1 style="font-size:48px;letter-spacing:15px;color:#333;margin:0;font-family:monospace">${safeOtp}</h1>
                    </div>
                    <p style="color:#999"><strong>This code expires in 5 minutes.</strong></p>
                    <hr style="border:0;border-top:1px solid #eee;margin:20px 0">
                    <p style="color:#999;font-size:12px">If you didn't request this code, please ignore this email.</p>
                </div>
            </div>
        `
    };

    await send(mailOptions);
    return { success: true, message: 'OTP sent successfully' };
};

const sendResetPasswordEmail = async (email, resetLink) => {
    if (!email || !resetLink) {
        throw new Error('Reset email requires a recipient and reset link');
    }

    const safeResetLink = safeUrl(resetLink);
    if (safeResetLink === '#') {
        throw new Error('Invalid reset link');
    }

    const mailOptions = {
        to: email,
        subject: 'Reset Your Blogify Password',
        text: `We received a request to reset your Blogify password. Use this link within 30 minutes: ${resetLink}\n\nIf you did not request this, ignore this email.`,
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

    await send(mailOptions);
    return { success: true, message: 'Reset link sent successfully' };
};

const sendCommentNotificationEmail = async (recipientEmail, data = {}) => {
    const actorName = escapeHtml(data.actorName || 'Someone');
    const blogTitle = escapeHtml(data.blogTitle || 'your blog');
    const comment = escapeHtml(data.comment || '');
    const blogLink = safeUrl(data.blogLink);

    const mailOptions = {
        to: recipientEmail,
        subject: `New comment on "${String(data.blogTitle || 'your blog').slice(0, 120)}"`,
        text: `${data.actorName || 'Someone'} commented on "${data.blogTitle || 'your blog'}":\n\n${data.comment || ''}\n\nView the blog: ${data.blogLink || ''}`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:20px;background:#667eea">
                <div style="background:#fff;border-radius:10px;padding:30px">
                    <h2 style="color:#667eea">New Comment on Your Blog</h2>
                    <p style="color:#666;line-height:1.6"><strong>${actorName}</strong> commented on your blog <strong>&quot;${blogTitle}&quot;</strong>:</p>
                    <div style="background:#f5f5f5;border-left:4px solid #667eea;padding:15px;border-radius:5px;margin:20px 0">
                        <p style="color:#333;margin:0;font-style:italic">&quot;${comment}&quot;</p>
                    </div>
                    <div style="text-align:center;margin:20px 0">
                        <a href="${blogLink}" style="display:inline-block;background:#667eea;color:#fff;padding:12px 30px;border-radius:8px;text-decoration:none">View Blog &amp; Reply</a>
                    </div>
                </div>
            </div>
        `
    };

    await send(mailOptions);
    return { success: true };
};

const sendFollowNotificationEmail = async (recipientEmail, data = {}) => {
    const followerName = escapeHtml(data.followerName || 'Someone');
    const followerImage = safeUrl(data.followerImage);
    const profileLink = safeUrl(data.profileLink);

    const mailOptions = {
        to: recipientEmail,
        subject: `${String(data.followerName || 'Someone').slice(0, 120)} started following you`,
        text: `${data.followerName || 'Someone'} started following you. View profile: ${data.profileLink || ''}`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:20px;background:#667eea">
                <div style="background:#fff;border-radius:10px;padding:30px;text-align:center">
                    <h2 style="color:#667eea">New Follower</h2>
                    <p style="color:#666;line-height:1.6"><strong>${followerName}</strong> started following you!</p>
                    ${followerImage !== '#' ? `<div style="margin:25px 0"><img src="${followerImage}" alt="Profile" style="width:80px;height:80px;border-radius:50%"></div>` : ''}
                    <a href="${profileLink}" style="display:inline-block;background:#667eea;color:#fff;padding:12px 30px;border-radius:8px;text-decoration:none">View Profile</a>
                </div>
            </div>
        `
    };

    await send(mailOptions);
    return { success: true };
};

const sendEmail = async (to, subject, htmlContent) => {
    if (!to || !subject || !htmlContent) {
        throw new Error('Email requires recipient, subject and content');
    }

    await send({
        to,
        subject: String(subject).slice(0, 200),
        html: htmlContent
    });
    return { success: true, message: 'Email sent successfully' };
};

module.exports = {
    sendOTPEmail,
    sendResetPasswordEmail,
    sendCommentNotificationEmail,
    sendFollowNotificationEmail,
    sendEmail
};
