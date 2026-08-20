// routes/GoogleAuthentication.js
const { Router } = require("express");
const passport = require("passport");
const User = require("../models/user");
const { creatTokenForUser } = require("../services/authentication");

const router = Router();

// ====================== GOOGLE OAUTH CONFIG ======================
// Google requires the callback URL used by Passport to exactly match one of
// the Authorized redirect URIs configured in Google Cloud Console.
// Keep GOOGLE_CALLBACK_URL explicit in production. The fallbacks make the
// app safer to deploy when that variable was accidentally omitted on Render
// or Vercel.
const normalizeBaseUrl = (value) => {
    if (!value) return "";
    let url = String(value).trim();
    if (!url) return "";
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    return url.replace(/\/+$/, "");
};

const configuredBaseUrl = normalizeBaseUrl(
    process.env.APP_URL ||
    process.env.FRONTEND_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    process.env.RENDER_EXTERNAL_URL
);

const googleCallbackUrl = normalizeBaseUrl(process.env.GOOGLE_CALLBACK_URL) ||
    (configuredBaseUrl ? `${configuredBaseUrl}/user/auth/google/callback` : "");

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    if (!googleCallbackUrl) {
        console.error(
            "Google OAuth is configured but no callback URL is available. Set GOOGLE_CALLBACK_URL to https://<your-domain>/user/auth/google/callback."
        );
    }

    passport.use(
        "google",
        new (require("passport-google-oauth20").Strategy)({
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: googleCallbackUrl,
        }, async (accessToken, refreshToken, profile, done) => {
            try {
                if (!profile?.id) {
                    return done(new Error("Google did not return a valid account ID."));
                }

                const email = profile.emails?.[0]?.value?.trim().toLowerCase();
                if (!email) {
                    return done(new Error("Google did not return an email address. Please allow email access and try again."));
                }

                const user = await User.findOrCreateGoogleUser(profile);
                if (!user) {
                    return done(new Error("Unable to create or find your Blogify account."));
                }

                return done(null, user);
            } catch (err) {
                console.error("Google Strategy Error:", err);
                return done(err);
            }
        })
    );
}

// These are kept for Passport compatibility. Blogify uses JWT cookies rather
// than Passport sessions for its actual authentication state.
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err);
    }
});

// ====================== GOOGLE ROUTES ======================
router.get("/auth/google", (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !googleCallbackUrl) {
        console.error("Google OAuth is unavailable: missing Google OAuth environment variables.");
        return res.redirect("/user/signin?error=google_not_configured");
    }

    return passport.authenticate("google", {
        scope: ["profile", "email"],
        session: false,
    })(req, res, next);
});

router.get("/auth/google/callback", (req, res, next) => {
    passport.authenticate("google", { session: false }, (err, user, info) => {
        if (err) {
            console.error("Google callback authentication failed:", err);
            return res.redirect("/user/signin?error=google_auth_failed");
        }

        if (!user) {
            console.error("Google callback returned no user:", info || "unknown reason");
            return res.redirect("/user/signin?error=google_auth_failed");
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

            return res.redirect("/?auth=success");
        } catch (tokenError) {
            console.error("Google JWT creation failed:", tokenError);
            return res.redirect("/user/signin?error=google_auth_failed");
        }
    })(req, res, next);
});

module.exports = router;
