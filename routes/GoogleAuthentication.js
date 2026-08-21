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
const GOOGLE_CALLBACK_PATH = "/auth/google/callback";
const GOOGLE_STATE_COOKIE = "blogify_google_oauth_state";
const GOOGLE_STATE_MAX_AGE = 10 * 60 * 1000;

function normalizeBaseUrl(value) {
    if (!value) return "";
    let url = String(value).trim();
    if (!url) return "";
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    return url.replace(/\/$/, "");
}

function appendCallbackPath(value) {
    const base = normalizeBaseUrl(value);
    if (!base) return "";
    return base.endsWith(GOOGLE_CALLBACK_PATH) ? base : `${base}${GOOGLE_CALLBACK_PATH}`;
}

// Vercel's production URL is authoritative when running on Vercel. This avoids
// a stale GOOGLE_CALLBACK_URL pointing at an old preview deployment.
function getGoogleCallbackURL() {
    if (process.env.VERCEL) {
        const vercelProduction = appendCallbackPath(process.env.VERCEL_PROJECT_PRODUCTION_URL);
        if (vercelProduction) return vercelProduction;

        const explicit = appendCallbackPath(process.env.GOOGLE_CALLBACK_URL);
        if (explicit) return explicit;

        const appUrl = appendCallbackPath(process.env.APP_URL);
        if (appUrl) return appUrl;

        const vercel = appendCallbackPath(process.env.VERCEL_URL);
        if (vercel) return vercel;
    }

    const explicit = appendCallbackPath(process.env.GOOGLE_CALLBACK_URL);
    if (explicit) return explicit;

    const appUrl = appendCallbackPath(process.env.APP_URL);
    if (appUrl) return appUrl;

    if (process.env.RENDER) {
        const render = appendCallbackPath(process.env.RENDER_EXTERNAL_URL);
        if (render) return render;
    }

    if (process.env.NODE_ENV === "production") {
        return appendCallbackPath("https://blogify-demo-five.vercel.app");
    }

    return `http://localhost:${process.env.PORT || 8000}${GOOGLE_CALLBACK_PATH}`;
}

const GOOGLE_CALLBACK_URL = getGoogleCallbackURL();

console.log("Google OAuth configuration:", {
    clientIdConfigured: Boolean(GOOGLE_CLIENT_ID),
    clientSecretConfigured: Boolean(GOOGLE_CLIENT_SECRET),
    callbackURL: GOOGLE_CALLBACK_URL,
    deployment: process.env.VERCEL ? "vercel" : process.env.RENDER ? "render" : "other",
    vercelProductionURL: process.env.VERCEL_PROJECT_PRODUCTION_URL || null,
    explicitCallbackConfigured: Boolean(process.env.GOOGLE_CALLBACK_URL),
});

function isProduction() {
    return process.env.NODE_ENV === "production";
}

function cookieOptions() {
    return {
        httpOnly: true,
        secure: isProduction(),
        sameSite: "lax",
        maxAge: GOOGLE_STATE_MAX_AGE,
        path: "/",
    };
}

function generateOAuthState() {
    return crypto.randomBytes(32).toString("hex");
}

function redirectToSignin(res, error = "google_auth_failed") {
    return res.redirect(`/user/signin?error=${encodeURIComponent(error)}`);
}

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
            if (!email) return done(new Error("Google did not return an email address."));
            const user = await User.findOrCreateGoogleUser(profile);
            if (!user) return done(new Error("Unable to create or find your Blogify account."));
            if (user.isBlocked === true) return done(new Error("Your Blogify account has been blocked."));
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
        return done(error);
    }
});

router.get("/auth/google", (req, res, next) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return redirectToSignin(res, "google_not_configured");
    const state = generateOAuthState();
    res.cookie(GOOGLE_STATE_COOKIE, state, cookieOptions());
    return passport.authenticate("google", {
        scope: ["profile", "email"],
        session: false,
        state,
        prompt: "select_account",
    })(req, res, next);
});

router.get("/auth/google/callback", (req, res, next) => {
    if (req.query?.error) {
        res.clearCookie(GOOGLE_STATE_COOKIE, cookieOptions());
        return redirectToSignin(res);
    }

    const returnedState = typeof req.query?.state === "string" ? req.query.state : "";
    let storedState = req.cookies?.[GOOGLE_STATE_COOKIE] || "";
    if (!storedState) {
        const match = (req.headers.cookie || "").split(";").map((part) => part.trim())
            .find((part) => part.startsWith(`${GOOGLE_STATE_COOKIE}=`));
        if (match) storedState = decodeURIComponent(match.substring(`${GOOGLE_STATE_COOKIE}=`.length));
    }
    res.clearCookie(GOOGLE_STATE_COOKIE, cookieOptions());

    if (!returnedState || !storedState || returnedState.length !== storedState.length) {
        console.error("Google OAuth state validation failed");
        return redirectToSignin(res);
    }

    let stateValid = false;
    try {
        stateValid = crypto.timingSafeEqual(Buffer.from(returnedState, "utf8"), Buffer.from(storedState, "utf8"));
    } catch (error) {
        console.error("Google OAuth state comparison failed:", error.message);
    }
    if (!stateValid) return redirectToSignin(res);

    return passport.authenticate("google", { session: false }, (err, user, info) => {
        if (err || !user) {
            console.error("Google callback authentication failed:", err || info);
            return redirectToSignin(res);
        }
        try {
            const token = creatTokenForUser(user);
            res.cookie("token", token, {
                httpOnly: true,
                secure: isProduction(),
                sameSite: "lax",
                maxAge: 7 * 24 * 60 * 60 * 1000,
                path: "/",
            });
            return res.redirect("/?auth=success");
        } catch (error) {
            console.error("Google JWT creation failed:", error);
            return redirectToSignin(res);
        }
    })(req, res, next);
});

module.exports = router;
