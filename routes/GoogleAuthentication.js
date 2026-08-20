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
    return base.endsWith(GOOGLE_CALLBACK_PATH)
        ? base
        : `${base}${GOOGLE_CALLBACK_PATH}`;
}

/*
 * IMPORTANT FOR VERCEL:
 * GOOGLE_CALLBACK_URL is deliberately checked FIRST.
 *
 * Google OAuth requires the redirect_uri sent by the app to be an EXACT
 * character-for-character match with an Authorized redirect URI in Google
 * Cloud Console. Vercel creates different hostnames for preview deployments,
 * so automatically choosing VERCEL_URL can cause redirect_uri_mismatch.
 *
 * Set GOOGLE_CALLBACK_URL in the Vercel Production environment to the exact
 * callback URI registered in Google Cloud Console, for example:
 * https://your-production-domain.com/auth/google/callback
 *
 * Render can use RENDER_EXTERNAL_URL. Local development falls back to
 * localhost.
 */
function getGoogleCallbackURL() {
    const explicitlyConfigured = appendCallbackPath(
        process.env.GOOGLE_CALLBACK_URL
    );
    if (explicitlyConfigured) return explicitlyConfigured;

    if (process.env.RENDER_EXTERNAL_URL) {
        const renderUrl = appendCallbackPath(process.env.RENDER_EXTERNAL_URL);
        if (renderUrl) return renderUrl;
    }

    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
        const productionUrl = appendCallbackPath(
            process.env.VERCEL_PROJECT_PRODUCTION_URL
        );
        if (productionUrl) return productionUrl;
    }

    if (process.env.VERCEL_URL) {
        const vercelUrl = appendCallbackPath(process.env.VERCEL_URL);
        if (vercelUrl) return vercelUrl;
    }

    const port = process.env.PORT || 8000;
    return `http://localhost:${port}${GOOGLE_CALLBACK_PATH}`;
}

const GOOGLE_CALLBACK_URL = getGoogleCallbackURL();

// JWT-cookie authentication is used by Blogify, so Passport's session-based
// OAuth state store is intentionally disabled. We validate our own short-lived
// state value using an HttpOnly cookie instead.
const GOOGLE_STATE_COOKIE = "blogify_google_oauth_state";
const GOOGLE_STATE_MAX_AGE = 10 * 60 * 1000;

console.log("Google OAuth configuration:", {
    clientIdConfigured: Boolean(GOOGLE_CLIENT_ID),
    clientSecretConfigured: Boolean(GOOGLE_CLIENT_SECRET),
    callbackURL: GOOGLE_CALLBACK_URL,
    deployment: process.env.VERCEL
        ? "vercel"
        : process.env.RENDER
            ? "render"
            : "other",
    explicitCallbackConfigured: Boolean(process.env.GOOGLE_CALLBACK_URL),
    vercelProductionURL: process.env.VERCEL_PROJECT_PRODUCTION_URL || null,
    vercelURL: process.env.VERCEL_URL || null,
    renderURL: process.env.RENDER_EXTERNAL_URL || null,
});

function isProduction() {
    return process.env.NODE_ENV === "production";
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
                // Do not use Passport's session state store; this application
                // does not use express-session.
                state: false,
            },
            async (accessToken, refreshToken, profile, done) => {
                try {
                    if (!profile?.id) {
                        return done(
                            new Error("Google did not return a valid account ID.")
                        );
                    }

                    const email = profile.emails?.[0]?.value
                        ?.trim()
                        .toLowerCase();

                    if (!email) {
                        return done(
                            new Error(
                                "Google did not return an email address. Please allow email access and try again."
                            )
                        );
                    }

                    const user = await User.findOrCreateGoogleUser(profile);

                    if (!user) {
                        return done(
                            new Error("Unable to create or find your Blogify account.")
                        );
                    }

                    if (user.isBlocked === true) {
                        return done(new Error("Your Blogify account has been blocked."));
                    }

                    return done(null, user);
                } catch (error) {
                    console.error("Google Strategy Error:", error);
                    return done(error);
                }
            }
        )
    );
} else {
    console.error(
        "Google OAuth is disabled: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing."
    );
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

    res.cookie(GOOGLE_STATE_COOKIE, state, {
        httpOnly: true,
        secure: isProduction(),
        sameSite: "lax",
        maxAge: GOOGLE_STATE_MAX_AGE,
        path: "/auth/google",
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
        console.error(
            "Google OAuth returned an error:",
            req.query.error,
            req.query.error_description || ""
        );

        res.clearCookie(GOOGLE_STATE_COOKIE, {
            httpOnly: true,
            secure: isProduction(),
            sameSite: "lax",
            path: "/auth/google",
        });

        return redirectToSignin(res);
    }

    const returnedState =
        typeof req.query?.state === "string" ? req.query.state : "";

    let storedState = "";

    if (req.cookies) {
        storedState = req.cookies[GOOGLE_STATE_COOKIE] || "";
    } else {
        const cookieHeader = req.headers.cookie || "";
        const match = cookieHeader
            .split(";")
            .map((part) => part.trim())
            .find((part) => part.startsWith(`${GOOGLE_STATE_COOKIE}=`));

        if (match) {
            storedState = decodeURIComponent(
                match.substring(`${GOOGLE_STATE_COOKIE}=`.length)
            );
        }
    }

    res.clearCookie(GOOGLE_STATE_COOKIE, {
        httpOnly: true,
        secure: isProduction(),
        sameSite: "lax",
        path: "/auth/google",
    });

    if (
        !returnedState ||
        !storedState ||
        returnedState.length !== storedState.length
    ) {
        console.error("Google OAuth state validation failed.");
        return redirectToSignin(res);
    }

    let stateValid = false;

    try {
        stateValid = crypto.timingSafeEqual(
            Buffer.from(returnedState, "utf8"),
            Buffer.from(storedState, "utf8")
        );
    } catch (error) {
        stateValid = false;
    }

    if (!stateValid) {
        console.error("Google OAuth state mismatch.");
        return redirectToSignin(res);
    }

    return passport.authenticate(
        "google",
        { session: false },
        (err, user, info) => {
            if (err) {
                console.error("Google callback authentication failed:", err);
                return redirectToSignin(res);
            }

            if (!user) {
                console.error(
                    "Google callback returned no user:",
                    info || "unknown reason"
                );
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

                console.log(
                    "Google login successful:",
                    user.email || user._id
                );

                return res.redirect("/?auth=success");
            } catch (tokenError) {
                console.error("Google JWT creation failed:", tokenError);
                return redirectToSignin(res);
            }
        }
    )(req, res, next);
});

module.exports = router;
