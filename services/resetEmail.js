const nodemailer = require('nodemailer');
require('dotenv').config();

function getSmtpConfig() {
    const user = (process.env.EMAIL_USER || '').trim();
    const password = (process.env.EMAIL_PASSWORD || '').replace(/\s+/g, '');

    if (!user || !password) {
        throw new Error('EMAIL_USER or EMAIL_PASSWORD is not configured');
    }

    const configuredPort = Number(process.env.SMTP_PORT || 0);
    const configuredSecure = process.env.SMTP_SECURE;

    return {
        user,
        password,
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        // Gmail supports both 465/SSL and 587/STARTTLS. 587 is used by
        // default because it is generally more reliable for serverless hosts.
        port: configuredPort || 587,
        secure: configuredSecure != null
            ? String(configuredSecure).toLowerCase() === 'true'
            : false
    };
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
        await transporter.verify();
        return await transporter.sendMail(mailOptions);
    } finally {
        transporter.close();
    }
}

async function sendResetPasswordEmail(email, resetLink) {
    if (!email || !resetLink) {
        throw new Error('Reset email requires a recipient and reset link');
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
    };

    try {
        const info = await sendWithConfig(mailOptions, smtp);
        console.log(`Password reset email sent to ${email}; messageId=${info.messageId}`);
        return { success: true, message: 'Reset link sent successfully' };
    } catch (firstError) {
        // If the default Gmail STARTTLS connection is unavailable, retry once
        // with Gmail's implicit TLS endpoint. This is useful across different
        // Vercel regions/network paths without changing application behavior.
        const isDefaultGmailConfig = smtp.host === 'smtp.gmail.com' && !process.env.SMTP_PORT && !process.env.SMTP_SECURE;
        if (!isDefaultGmailConfig) {
            console.error(`Password reset email failed: ${firstError.code || 'SMTP_ERROR'} ${firstError.message}`);
            throw firstError;
        }

        const fallback = { ...smtp, port: 465, secure: true };
        try {
            const info = await sendWithConfig(mailOptions, fallback);
            console.log(`Password reset email sent using Gmail SSL fallback to ${email}; messageId=${info.messageId}`);
            return { success: true, message: 'Reset link sent successfully' };
        } catch (fallbackError) {
            console.error(`Password reset email failed on SMTP 587 and 465: ${fallbackError.code || 'SMTP_ERROR'} ${fallbackError.message}`);
            const combined = new Error(`Unable to send reset email: ${fallbackError.message}`);
            combined.code = fallbackError.code || firstError.code;
            throw combined;
        }
    }
}

module.exports = { sendResetPasswordEmail };
