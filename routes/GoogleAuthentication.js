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
    try {
        const parsed = new URL(url);
        if (!/^https?:$/.test(parsed.protocol)) return "";
        return parsed.origin;
    } catch (_) {
        return "";
    }
}

function appendCallbackPath(value) {
    const base = normalizeBaseUrl(value);
    return base ? `${base}${GOOGLE_CALLBACK_PATH}` : "";
}

/*
 * Google requires an exact redirect URI. Prefer an explicit production value
 * so a stale preview hostname can never silently become the OAuth callback.
 * Render/Vercel platform URLs are only fallbacks when no explicit URL exists.
 */
function getGoogleCallbackURL() {
    const explicit = appendCallbackPath(process.env.GOOGLE_CALLBACK_URL);
    if (explicit) return explicit;

    const appUrl = appendCallbackPath(process.env.APP_URL);
    if (appUrl) return appUrl;

    const render = appendCallbackPath(process.env.RENDER_EXTERNAL_URL);
    if (render) return render;

    const vercelProduction = appendCallbackPath(process.env.VERCEL_PROJECT_PRODUCTION_URL);
    if (vercelProduction) return vercelProduction;

    const vercel = appendCallbackPath(process.env.VERCEL_URL);
    if (vercel) return vercel;

    if (process.env.NODE_ENV !== "production") {
        return `http://localhost:${process.env.PORT || 8000}${GOOGLE_CALLBACK_PATH}`;
    }

    return "";
}

const GOOGLE_CALLBACK_URL = getGoogleCallbackURL();

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
    console.error("Google OAuth is not fully configured", {
        clientIdConfigured: Boolean(GOOGLE_CLIENT_ID),
        clientSecretConfigured: Boolean(GOOGLE_CLIENT_SECRET),
        callbackConfigured: Boolean(GOOGLE_CALLBACK_URL),
    });
}

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

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_CALLBACK_URL) {
    passport.use("google", new GoogleStrategy({
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
        // Blogify validates OAuth state itself using a short-lived HttpOnly cookie.
        state: false,
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            if (!profile?.id) return done(new Error("Google did not return a valid account ID."));
            const email = profile.emails?.[0]?.value?.trim().toLowerCase();
            if (!email) return done(new Error("Google did not return an email address."));

            const user = await User.findOrCreateGoogleUser(profile);
            if (!user) return done(new Error("Unable to create or find your Blogify account."));
            if (user.isBlocked === true) return done(new Error("Your Blogify account has been blocked."));
            if (user.isDeactivated === true) return done(new Error("Account is deactivated."));

            return done(null, user);
        } catch (error) {
            console.error("Google Strategy Error:", error.message);
            return done(error);
        }
    }));
}

// Passport compatibility only; Blogify authentication uses JWT cookies.
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
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
        return redirectToSignin(res, "google_not_configured");
    }

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
        return redirectToSignin(res, "google_auth_denied");
    }

    const returnedState = typeof req.query?.state === "string" ? req.query.state : "";
    let storedState = req.cookies?.[GOOGLE_STATE_COOKIE] || "";

    if (!storedState) {
        const match = (req.headers.cookie || "").split(";")
            .map((part) => part.trim())
            .find((part) => part.startsWith(`${GOOGLE_STATE_COOKIE}=`));
        if (match) {
            storedState = decodeURIComponent(match.substring(`${GOOGLE_STATE_COOKIE}=`.length));
        }
    }

    res.clearCookie(GOOGLE_STATE_COOKIE, cookieOptions());

    if (!returnedState || !storedState || returnedState.length !== storedState.length) {
        console.error("Google OAuth state validation failed");
        return redirectToSignin(res);
    }

    let stateValid = false;
    try {
        stateValid = crypto.timingSafeEqual(
            Buffer.from(returnedState, "utf8"),
            Buffer.from(storedState, "utf8")
        );
    } catch (_) {
        stateValid = false;
    }

    if (!stateValid) return redirectToSignin(res, "google_state_invalid");

    return passport.authenticate("google", { session: false }, (err, user, info) => {
        if (err || !user) {
            console.error("Google callback authentication failed:", err?.message || info || "unknown error");
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
            console.error("Google JWT creation failed:", error.message);
            return redirectToSignin(res);
        }
    })(req, res, next);
});

module.exports = router;
