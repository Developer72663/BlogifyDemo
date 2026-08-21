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

// Google requires an exact redirect URI. Render is also used by Blogify for
// Socket.IO, so RENDER_EXTERNAL_URL can exist in Vercel's environment. Never
// let that Render URL become the OAuth callback when this function runs on
// Vercel.
function getGoogleCallbackURL() {
    const explicit = appendCallbackPath(process.env.GOOGLE_CALLBACK_URL);
    if (explicit) return explicit;

    const appUrl = appendCallbackPath(process.env.APP_URL);

    if (process.env.VERCEL) {
        const vercelProduction = appendCallbackPath(process.env.VERCEL_PROJECT_PRODUCTION_URL);
        if (vercelProduction) return vercelProduction;
        if (appUrl) return appUrl;

        // VERCEL_URL can be a preview URL. Use it only as a last Vercel fallback.
        const vercel = appendCallbackPath(process.env.VERCEL_URL);
        if (vercel) return vercel;
    }

    if (process.env.RENDER) {
        const render = appendCallbackPath(process.env.RENDER_EXTERNAL_URL);
        if (render) return render;
        if (appUrl) return appUrl;
    }

    if (appUrl) return appUrl;

    if (process.env.NODE_ENV === "production") {
        return appendCallbackPath("https://blogify-demo-topaz.vercel.app");
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
    renderExternalURL: process.env.RENDER_EXTERNAL_URL || null,
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
    passport.use(
        "google",
        new GoogleStrategy(
            {
                clientID: GOOGLE_CLIENT_ID,
                clientSecret: GOOGLE_CLIENT_SECRET,
                callbackURL: GOOGLE_CALLBACK_URL,
                state: false,
            },
            async (accessToken, refreshToken, profile, done) => {
                try {
                    if (!profile?.id) return done(new Error("Google did not return a valid account ID."));
                    const email = profile.emails?.[0]?.value?.trim().toLowerCase();
                    if (!email) return done(new Error("Google did not return an email address. Please allow email access and try again."));
                    const user = await User.findOrCreateGoogleUser(profile);
                    if (!user) return done(new Error("Unable to create or find your Blogify account."));
                    if (user.isBlocked === true) return done(new Error("Your Blogify account has been blocked."));
                    return done(null, user);
                } catch (error) {
                    console.error("Google Strategy Error:", error);
                    return done(error);
                }
            }
        )
    );
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
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        console.error("Google login attempted without OAuth credentials.");
        return redirectToSignin(res, "google_not_configured");
    }

    const state = generateOAuthState();
    res.cookie(GOOGLE_STATE_COOKIE, state, cookieOptions());
    console.log("Starting Google OAuth", {
        callbackURL: GOOGLE_CALLBACK_URL,
        stateStored: true,
        requestPath: req.originalUrl,
        host: req.get("host"),
    });

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
        res.clearCookie(GOOGLE_STATE_COOKIE, cookieOptions());
        return redirectToSignin(res);
    }

    const returnedState = typeof req.query?.state === "string" ? req.query.state : "";
    let storedState = req.cookies?.[GOOGLE_STATE_COOKIE] || "";

    if (!storedState) {
        const cookieHeader = req.headers.cookie || "";
        const match = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${GOOGLE_STATE_COOKIE}=`));
        if (match) storedState = decodeURIComponent(match.substring(`${GOOGLE_STATE_COOKIE}=`.length));
    }

    res.clearCookie(GOOGLE_STATE_COOKIE, cookieOptions());

    if (!returnedState || !storedState) {
        console.error("Google OAuth state validation failed: missing state", {
            returnedState: Boolean(returnedState),
            storedState: Boolean(storedState),
            callbackPath: req.path,
            host: req.get("host"),
            callbackURL: GOOGLE_CALLBACK_URL,
        });
        return redirectToSignin(res);
    }

    if (returnedState.length !== storedState.length) {
        console.error("Google OAuth state validation failed: length mismatch");
        return redirectToSignin(res);
    }

    let stateValid = false;
    try {
        stateValid = crypto.timingSafeEqual(Buffer.from(returnedState, "utf8"), Buffer.from(storedState, "utf8"));
    } catch (error) {
        console.error("Google OAuth state comparison failed:", error.message);
    }

    if (!stateValid) {
        console.error("Google OAuth state mismatch", { callbackPath: req.path, host: req.get("host"), callbackURL: GOOGLE_CALLBACK_URL });
        return redirectToSignin(res);
    }

    return passport.authenticate("google", { session: false }, (err, user, info) => {
        if (err) {
            console.error("Google callback authentication failed:", err);
            return redirectToSignin(res);
        }
        if (!user) {
            console.error("Google callback returned no user:", info || "unknown reason");
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
            console.log("Google login successful:", user.email || user._id);
            return res.redirect("/?auth=success");
        } catch (tokenError) {
            console.error("Google JWT creation failed:", tokenError);
            return redirectToSignin(res);
        }
    })(req, res, next);
});

module.exports = router;
