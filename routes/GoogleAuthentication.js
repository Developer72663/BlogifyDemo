// routes/GoogleAuthentication.js
const { Router } = require("express");
const passport = require("passport");
const User = require("../models/user");
const { creatTokenForUser } = require("../services/authentication");

const router = Router();

// ====================== GOOGLE STRATEGY ======================
const GoogleStrategy = require("passport-google-oauth20").Strategy;

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
        "google",
        new GoogleStrategy(
            {
                clientID: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                callbackURL: process.env.GOOGLE_CALLBACK_URL,
            },
            async (accessToken, refreshToken, profile, done) => {
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
            }
        )
    );
}

// These are kept for Passport compatibility. This app uses JWT cookies,
// not Passport sessions, for the actual Blogify authentication state.
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
router.get(
    "/auth/google",
    passport.authenticate("google", {
        scope: ["profile", "email"],
        session: false,
    })
);

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
