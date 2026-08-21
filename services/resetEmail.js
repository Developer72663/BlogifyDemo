// Keep password-reset email delivery on the same hardened provider used by all other emails.
// This also allows Render Free deployments to use the Resend HTTPS API instead of blocked SMTP ports.
const { sendResetPasswordEmail } = require('./email');

module.exports = { sendResetPasswordEmail };
