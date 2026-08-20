// routes/GoogleAuthentication.js

const { Router } = require("express");
const passport = require("passport");
const User = require("../models/user");
const { creatTokenForUser } = require("../services/authentication");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const router = Router();

/*
|--------------------------------------------------------------------------
| Google OAuth configuration
|--------------------------------------------------------------------------
|
| Recommended environment variables:
|
| GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
| GOOGLE_CLIENT_SECRET=xxxxxxxx
|
| GOOGLE_CALLBACK_URL=https://your-domain.com/auth/google/callback
|
| For Render, use:
| https://blogifydemo.onrender.com/auth/google/callback
|
| If you also use Vercel, create a separate callback URL for the Vercel
| deployment and add it to Google Cloud Console.
|
*/

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim();
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim();

/*
 * Build the callback URL safely.
 *
 * Priority:
 * 1. GOOGLE_CALLBACK_URL
 * 2. RENDER_EXTERNAL_URL
 * 3. VERCEL_URL
 *
 * GOOGLE_CALLBACK_URL is recommended because it gives you complete control.
 */
function getGoogleCallbackURL() {
    if (process.env.GOOGLE_CALLBACK_URL?.trim()) {
        return process.env.GOOGLE_CALLBACK_URL.trim();
    }

    if (process.env.RENDER_EXTERNAL_URL?.trim()) {
        return `${process.env.RENDER_EXTERNAL_URL.trim().replace(/\/$/, "")}/auth/google/callback`;
    }

    if (process.env.VERCEL_URL?.trim()) {
        return `https://${process.env.VERCEL_URL.trim()}/auth/google/callback`;
    }

    /*
     * Local development fallback.
     */
    const port = process.env.PORT || 8000;

    return `http://localhost:${port}/auth/google/callback`;
}

const GOOGLE_CALLBACK_URL = getGoogleCallbackURL();

console.log("Google OAuth configuration:", {
    clientIdConfigured: Boolean(GOOGLE_CLIENT_ID),
    clientSecretConfigured: Boolean(GOOGLE_CLIENT_SECRET),
    callbackURL: GOOGLE_CALLBACK_URL,
});

/*
|--------------------------------------------------------------------------
| Google Passport Strategy
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
                 * Passport will use the state parameter to protect the
                 * OAuth flow against CSRF-style attacks.
                 */
                state: true,
            },

            async (accessToken, refreshToken, profile, done) => {
                try {
                    /*
                     * Validate Google profile.
                     */
                    if (!profile || !profile.id) {
                        return done(
                            new Error(
                                "Google did not return a valid account ID."
                            )
                        );
                    }

                    /*
                     * Google should normally return an email because
                     * we request the email scope.
                     */
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
                     * Create or find the Blogify account.
                     */
                    const user = await User.findOrCreateGoogleUser(profile);

                    if (!user) {
                        return done(
                            new Error(
                                "Unable to create or find your Blogify account."
                            )
                        );
                    }

                    /*
                     * Optional safety check.
                     *
                     * If your User model has an isBlocked field, prevent a
                     * blocked account from logging in through Google.
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
| Passport serialization
|--------------------------------------------------------------------------
|
| Blogify itself uses JWT cookies instead of Passport sessions.
| These functions remain here for Passport compatibility.
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
| Start Google authentication
|--------------------------------------------------------------------------
*/

router.get("/auth/google", (req, res, next) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        console.error(
            "Google login attempted but OAuth credentials are not configured."
        );

        return res.redirect(
            "/user/signin?error=google_not_configured"
        );
    }

    return passport.authenticate("google", {
        scope: ["profile", "email"],

        /*
         * Blogify uses JWT authentication, not Passport sessions.
         */
        session: false,

        /*
         * Explicitly request offline access only if your application
         * actually needs a Google refresh token.
         *
         * We don't need one just to authenticate the Blogify user.
         */
        prompt: "select_account",
    })(req, res, next);
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
         * Google can send an OAuth error directly to this callback.
         */
        if (req.query?.error) {
            console.error(
                "Google OAuth returned an error:",
                req.query.error,
                req.query.error_description || ""
            );

            return res.redirect(
                "/user/signin?error=google_auth_failed"
            );
        }

        return passport.authenticate(
            "google",
            {
                session: false,
            },

            (err, user, info) => {
                /*
                 * Passport authentication error.
                 */
                if (err) {
                    console.error(
                        "Google callback authentication failed:",
                        err
                    );

                    return res.redirect(
                        "/user/signin?error=google_auth_failed"
                    );
                }

                /*
                 * No user returned.
                 */
                if (!user) {
                    console.error(
                        "Google callback returned no user:",
                        info || "unknown reason"
                    );

                    return res.redirect(
                        "/user/signin?error=google_auth_failed"
                    );
                }

                try {
                    /*
                     * Create Blogify JWT.
                     */
                    const token = creatTokenForUser(user);

                    /*
                     * Secure authentication cookie.
                     */
                    res.cookie("token", token, {
                        httpOnly: true,

                        /*
                         * HTTPS on Render/Vercel.
                         */
                        secure:
                            process.env.NODE_ENV === "production",

                        /*
                         * Lax works well for OAuth callback redirects
                         * while still providing CSRF protection.
                         */
                        sameSite: "lax",

                        /*
                         * Seven-day login.
                         */
                        maxAge:
                            7 *
                            24 *
                            60 *
                            60 *
                            1000,

                        path: "/",
                    });

                    /*
                     * Successful Google login.
                     */
                    return res.redirect("/?auth=success");
                } catch (tokenError) {
                    console.error(
                        "Google JWT creation failed:",
                        tokenError
                    );

                    return res.redirect(
                        "/user/signin?error=google_auth_failed"
                    );
                }
            }
        )(req, res, next);
    }
);

/*
|--------------------------------------------------------------------------
| Export router
|--------------------------------------------------------------------------
*/

module.exports = router;
