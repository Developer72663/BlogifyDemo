// routes/GoogleAuthentication.js

const { Router } = require("express");
const crypto = require("crypto");
const passport = require("passport");
const User = require("../models/user");
const { creatTokenForUser } = require("../services/authentication");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const router = Router();

/*
|--------------------------------------------------------------------------
| Google OAuth configuration
|--------------------------------------------------------------------------
*/

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim();
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim();

function getGoogleCallbackURL() {
    if (process.env.GOOGLE_CALLBACK_URL?.trim()) {
        return process.env.GOOGLE_CALLBACK_URL.trim();
    }

    if (process.env.RENDER_EXTERNAL_URL?.trim()) {
        return (
            process.env.RENDER_EXTERNAL_URL.trim().replace(/\/$/, "") +
            "/auth/google/callback"
        );
    }

    if (process.env.VERCEL_URL?.trim()) {
        return (
            "https://" +
            process.env.VERCEL_URL.trim() +
            "/auth/google/callback"
        );
    }

    const port = process.env.PORT || 8000;

    return `http://localhost:${port}/auth/google/callback`;
}

const GOOGLE_CALLBACK_URL = getGoogleCallbackURL();

const GOOGLE_STATE_COOKIE = "blogify_google_oauth_state";
const GOOGLE_STATE_MAX_AGE = 10 * 60 * 1000; // 10 minutes

console.log("Google OAuth configuration:", {
    clientIdConfigured: Boolean(GOOGLE_CLIENT_ID),
    clientSecretConfigured: Boolean(GOOGLE_CLIENT_SECRET),
    callbackURL: GOOGLE_CALLBACK_URL,
});

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function isProduction() {
    return process.env.NODE_ENV === "production";
}

function generateOAuthState() {
    return crypto.randomBytes(32).toString("hex");
}

function safeRedirect(res, error = "google_auth_failed") {
    return res.redirect(
        `/user/signin?error=${encodeURIComponent(error)}`
    );
}

/*
|--------------------------------------------------------------------------
| Google Passport Strategy
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| Do NOT use:
|
|     state: true
|
| Passport's default OAuth state store requires express-session.
|
| Blogify uses JWT cookies rather than Passport sessions, so OAuth state
| is handled manually with a secure short-lived cookie.
|--------------------------------------------------------------------------
*/

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    passport.use(
        "google",
        new GoogleStrategy(
            {
                clientID: GOOGLE_CLIENT_ID,
                clientSecret: GOOGLE_CLIENT_SECRET,
                callbackURL: GOOGLE_CALLBACK_URL,

                /*
                 * IMPORTANT:
                 *
                 * Passport OAuth state is disabled here because the
                 * application does not use Passport sessions.
                 *
                 * We generate and validate our own state value below.
                 */
                state: false,
            },

            async (accessToken, refreshToken, profile, done) => {
                try {
                    if (!profile || !profile.id) {
                        return done(
                            new Error(
                                "Google did not return a valid account ID."
                            )
                        );
                    }

                    const email = profile.emails?.[0]?.value
                        ?.trim()
                        .toLowerCase();

                    if (!email) {
                        return done(
                            new Error(
                                "Google did not return an email address. " +
                                "Please allow email access and try again."
                            )
                        );
                    }

                    /*
                     * Find/create the Blogify account.
                     */
                    const user =
                        await User.findOrCreateGoogleUser(profile);

                    if (!user) {
                        return done(
                            new Error(
                                "Unable to create or find your Blogify account."
                            )
                        );
                    }

                    /*
                     * Prevent blocked users from logging in through Google.
                     */
                    if (user.isBlocked === true) {
                        return done(
                            new Error(
                                "Your Blogify account has been blocked."
                            )
                        );
                    }

                    return done(null, user);
                } catch (error) {
                    console.error(
                        "Google Strategy Error:",
                        error
                    );

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

/*
|--------------------------------------------------------------------------
| Passport compatibility
|--------------------------------------------------------------------------
|
| Blogify does NOT use Passport sessions for authentication.
| JWT cookies are used instead.
|--------------------------------------------------------------------------
*/

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);

        if (!user) {
            return done(null, false);
        }

        return done(null, user);
    } catch (error) {
        console.error(
            "Google deserializeUser error:",
            error
        );

        return done(error);
    }
});

/*
|--------------------------------------------------------------------------
| Start Google OAuth
|--------------------------------------------------------------------------
*/

router.get("/auth/google", (req, res, next) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        console.error(
            "Google login attempted but OAuth credentials are not configured."
        );

        return safeRedirect(
            res,
            "google_not_configured"
        );
    }

    /*
     * Generate cryptographically secure OAuth state.
     */
    const state = generateOAuthState();

    /*
     * Store state in a short-lived HTTP-only cookie.
     *
     * This does NOT require express-session.
     */
    res.cookie(
        GOOGLE_STATE_COOKIE,
        state,
        {
            httpOnly: true,
            secure: isProduction(),
            sameSite: "lax",
            maxAge: GOOGLE_STATE_MAX_AGE,
            path: "/auth/google",
        }
    );

    /*
     * Start Passport Google authentication.
     *
     * session:false is intentional because Blogify uses JWT.
     *
     * The generated state is supplied directly to Passport.
     */
    return passport.authenticate(
        "google",
        {
            scope: ["profile", "email"],
            session: false,
            state,
            prompt: "select_account",
        }
    )(req, res, next);
});

/*
|--------------------------------------------------------------------------
| Google OAuth callback
|--------------------------------------------------------------------------
*/

router.get(
    "/auth/google/callback",
    (req, res, next) => {
        /*
         * Google may return an error instead of a code.
         */
        if (req.query?.error) {
            console.error(
                "Google OAuth returned an error:",
                req.query.error,
                req.query.error_description || ""
            );

            res.clearCookie(
                GOOGLE_STATE_COOKIE,
                {
                    httpOnly: true,
                    secure: isProduction(),
                    sameSite: "lax",
                    path: "/auth/google",
                }
            );

            return safeRedirect(res);
        }

        /*
         * Get state sent back by Google.
         */
        const returnedState =
            typeof req.query?.state === "string"
                ? req.query.state
                : "";

        /*
         * Read our state cookie.
         *
         * cookie-parser is normally already available in Blogify.
         * The fallback parser below keeps this route safe even if
         * req.cookies is unavailable.
         */
        let storedState = "";

        if (req.cookies) {
            storedState =
                req.cookies[GOOGLE_STATE_COOKIE] || "";
        } else {
            const cookieHeader =
                req.headers.cookie || "";

            const match = cookieHeader
                .split(";")
                .map((part) => part.trim())
                .find((part) =>
                    part.startsWith(
                        `${GOOGLE_STATE_COOKIE}=`
                    )
                );

            if (match) {
                storedState = decodeURIComponent(
                    match.substring(
                        `${GOOGLE_STATE_COOKIE}=`.length
                    )
                );
            }
        }

        /*
         * Always clear the state cookie after callback processing.
         */
        res.clearCookie(
            GOOGLE_STATE_COOKIE,
            {
                httpOnly: true,
                secure: isProduction(),
                sameSite: "lax",
                path: "/auth/google",
            }
        );

        /*
         * OAuth state validation.
         *
         * This protects the callback from accepting an unrelated
         * OAuth response.
         */
        if (
            !returnedState ||
            !storedState ||
            returnedState.length !== storedState.length
        ) {
            console.error(
                "Google OAuth state validation failed: missing or invalid state."
            );

            return safeRedirect(res);
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
            console.error(
                "Google OAuth state validation failed: state mismatch."
            );

            return safeRedirect(res);
        }

        /*
         * Now let Passport exchange the authorization code
         * and obtain the Google profile.
         */
        return passport.authenticate(
            "google",
            {
                session: false,
            },
            (err, user, info) => {
                if (err) {
                    console.error(
                        "Google callback authentication failed:",
                        err
                    );

                    return safeRedirect(res);
                }

                if (!user) {
                    console.error(
                        "Google callback returned no user:",
                        info || "unknown reason"
                    );

                    return safeRedirect(res);
                }

                try {
                    /*
                     * Create Blogify JWT.
                     */
                    const token =
                        creatTokenForUser(user);

                    /*
                     * Store JWT securely.
                     */
                    res.cookie(
                        "token",
                        token,
                        {
                            httpOnly: true,
                            secure: isProduction(),
                            sameSite: "lax",
                            maxAge:
                                7 *
                                24 *
                                60 *
                                60 *
                                1000,
                            path: "/",
                        }
                    );

                    console.log(
                        "Google login successful:",
                        user.email || user._id
                    );

                    return res.redirect(
                        "/?auth=success"
                    );
                } catch (tokenError) {
                    console.error(
                        "Google JWT creation failed:",
                        tokenError
                    );

                    return safeRedirect(res);
                }
            }
        )(req, res, next);
    }
);

/*
|--------------------------------------------------------------------------
| Export
|--------------------------------------------------------------------------
*/

module.exports = router;
