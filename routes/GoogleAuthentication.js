// routes/GoogleAuthentication.js
const { Router } = require("express");
const crypto = require("crypto");
const passport = require("passport");
const User = require("../models/user");
const { creatTokenForUser } = require("../services/authentication");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const router = Router();
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim();
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim();

function normalizeOrigin(value) {
    if (!value) return "";
    let origin = String(value).trim().replace(/\/$/, "");
    if (!origin) return "";
    if (!/^https?:\/\//i.test(origin)) origin = `https://${origin}`;
    return origin.replace(/\/$/, "");
}

function getGoogleCallbackURL() {
    if (process.env.GOOGLE_CALLBACK_URL?.trim()) {
        return process.env.GOOGLE_CALLBACK_URL.trim().replace(/\/$/, "");
    }
    const vercelProduction = normalizeOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL);
    if (vercelProduction) return `${vercelProduction}/auth/google/callback`;
    const renderURL = normalizeOrigin(process.env.RENDER_EXTERNAL_URL);
    if (renderURL) return `${renderURL}/auth/google/callback`;
    const vercelURL = normalizeOrigin(process.env.VERCEL_URL);
    if (vercelURL) return `${vercelURL}/auth/google/callback`;
    const appURL = normalizeOrigin(process.env.APP_URL || process.env.FRONTEND_URL);
    if (appURL) return `${appURL}/auth/google/callback`;
    return `http://localhost:${process.env.PORT || 8000}/auth/google/callback`;
}

const GOOGLE_CALLBACK_URL = getGoogleCallbackURL();

// Stateless signed OAuth state avoids Passport's express-session requirement and
// works across Vercel serverless instances.
const GOOGLE_STATE_TTL = 10 * 60 * 1000;
const GOOGLE_STATE_SECRET = process.env.JWT_SECRET?.trim() || GOOGLE_CLIENT_SECRET || "";

function createOAuthState() {
    const payload = { iat: Date.now(), nonce: crypto.randomBytes(24).toString("hex") };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = crypto.createHmac("sha256", GOOGLE_STATE_SECRET).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
}

function verifyOAuthState(state) {
    if (!GOOGLE_STATE_SECRET || typeof state !== "string") return false;
    const parts = state.split(".");
    if (parts.length !== 2) return false;
    const [encoded, receivedSignature] = parts;
    if (!encoded || !receivedSignature) return false;
    const expectedSignature = crypto.createHmac("sha256", GOOGLE_STATE_SECRET).update(encoded).digest("base64url");
    const received = Buffer.from(receivedSignature, "utf8");
    const expected = Buffer.from(expectedSignature, "utf8");
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return false;
    try {
        const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
        const age = Date.now() - Number(payload?.iat);
        return Boolean(payload?.nonce) && Number.isFinite(age) && age >= 0 && age <= GOOGLE_STATE_TTL;
    } catch (error) {
        return false;
    }
}

function safeRedirect(res, error = "google_auth_failed") {
    return res.redirect(`/user/signin?error=${encodeURIComponent(error)}`);
}

console.log("Google OAuth configuration:", {
    clientIdConfigured: Boolean(GOOGLE_CLIENT_ID),
    clientSecretConfigured: Boolean(GOOGLE_CLIENT_SECRET),
    callbackURL: GOOGLE_CALLBACK_URL,
    statelessStateConfigured: Boolean(GOOGLE_STATE_SECRET),
});

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    passport.use("google", new GoogleStrategy({
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
        state: false,
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            if (!profile?.id) return done(new Error("Google did not return a valid account ID."));
            const email = profile.emails?.[0]?.value?.trim().toLowerCase();
            if (!email) return done(new Error("Google did not return an email address. Please allow email access and try again."));
            const user = await User.findOrCreateGoogleUser(profile);
            if (!user) return done(new Error("Unable to create or find your Blogify account."));
            if (user.isBlocked === true) return done(new Error("Your Blogify account has been blocked."));
            if (user.isDeactivated === true) return done(new Error("Your Blogify account is deactivated."));
            return done(null, user);
        } catch (error) {
            console.error("Google Strategy Error:", error);
            return done(error);
        }
    }));
} else {
    console.error("Google OAuth is disabled: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing.");
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        return done(null, user || false);
    } catch (error) {
        console.error("Google deserializeUser error:", error);
        return done(error);
    }
});

router.get("/auth/google", (req, res, next) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_STATE_SECRET) {
        console.error("Google OAuth credentials/state secret are not configured.");
        return safeRedirect(res, "google_not_configured");
    }
    const state = createOAuthState();
    console.log("Starting Google OAuth:", { callbackURL: GOOGLE_CALLBACK_URL, host: req.get("host") });
    return passport.authenticate("google", {
        scope: ["profile", "email"],
        session: false,
        state,
        prompt: "select_account",
    })(req, res, next);
});

router.get("/auth/google/callback", (req, res, next) => {
    if (req.query?.error) {
        console.error("Google OAuth returned an error:", req.query.error, req.query.error_description || "");
        return safeRedirect(res);
    }

    const returnedState = typeof req.query?.state === "string" ? req.query.state : "";
    if (!verifyOAuthState(returnedState)) {
        console.error("Google OAuth state validation failed.");
        return safeRedirect(res);
    }

    return passport.authenticate("google", { session: false }, (err, user, info) => {
        if (err) {
            console.error("Google callback authentication failed:", err);
            return safeRedirect(res);
        }
        if (!user) {
            console.error("Google callback returned no user:", info || "unknown reason");
            return safeRedirect(res);
        }
        try {
            const token = creatTokenForUser(user);
            res.cookie("token", token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                maxAge: 7 * 24 * 60 * 60 * 1000,
                path: "/",
            });
            console.log("Google login successful:", user.email || user._id);
            return res.redirect("/?auth=success");
        } catch (tokenError) {
            console.error("Google JWT creation failed:", tokenError);
            return safeRedirect(res);
        }
    })(req, res, next);
});

module.exports = router;
