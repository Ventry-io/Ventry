import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma/prisma";
import { toNextJsHandler } from "better-auth/next-js";
import { createAuthMiddleware, APIError, getSessionFromCtx } from "better-auth/api";
import { passkey } from "@better-auth/passkey";
import { lastLoginMethod, twoFactor, multiSession } from "better-auth/plugins";
import { hashPassword } from "@/lib/bcrypt";
import { verifyPassword } from "@/lib/auth/verify";
import { sendMail } from "@/lib/mail";
import { renderComponentToHTML } from "@/lib/helpers/html";
import WelcomeMail from "@/components/emails/WelcomeMail";
import EmailVerificationMail from "@/components/emails/EmailVerificationMail";
import { getTrustedOrigins } from "@/lib/security/origins";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/user/display-name";
import { signUpAdditionalFieldsSchema } from "@/types/schemas/signup";
import { resolveUniqueUsername, sanitizeUsername } from "@/lib/user/unique-name";

const cookiePrefix = "VENTRY";

function clampDisplayName(name: string | null | undefined) {
    return name?.slice(0, DISPLAY_NAME_MAX_LENGTH);
}

export const auth = betterAuth({
    rateLimit: {
        enabled: true,
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 100, // limit each IP to 100 requests per windowMs
    },
    advanced: {
        cookiePrefix,
    },
    baseURL: process.env.BETTER_AUTH_URL || process.env.NEXTAUTH_URL || "https://local.dev:3443",
    trustedOrigins: getTrustedOrigins(),
    secret: process.env.BETTER_AUTH_SECRET,
    plugins: [
        passkey(),
        lastLoginMethod(),
        multiSession(),
        // REMOVED nextCookies() - causes state_mismatch with custom domains
        twoFactor({
            otpOptions: {
                async sendOTP({ user: _user, otp: _otp }, _request) {
                    // TODO: Send email

                },
            }
        })
    ],
    session: {},
    hooks: {
        before: createAuthMiddleware(async (ctx) => {
            if (ctx.path === "/unlink-account") {
                const session = await getSessionFromCtx(ctx);
                if (!session) return; // The endpoint's session middleware rejects unauthenticated requests.
                if (ctx.body?.providerId === "credential" || ctx.body?.providerId === "credentials") {
                    throw new APIError("BAD_REQUEST", { message: "Email sign-in is required and cannot be removed." });
                }
                const accounts = await ctx.context.internalAdapter.findAccounts(session.user.id);
                if (!accounts.some(account => account.providerId === "credential" && account.password)) {
                    throw new APIError("BAD_REQUEST", { message: "Set an email password before removing linked accounts." });
                }
                return;
            }
            // Registration writes go straight through better-auth, bypassing any
            // client-side zod schema entirely, so this is the real validation
            // boundary for legalName/address*/name on sign-up.
            if (ctx.path !== "/sign-up/email") {
                return;
            }

            const parsed = signUpAdditionalFieldsSchema.safeParse(ctx.body);
            if (!parsed.success) {
                throw new APIError("BAD_REQUEST", {
                    message: parsed.error.issues[0]?.message ?? "Invalid registration data",
                });
            }

            return {
                context: {
                    ...ctx,
                    body: {
                        ...ctx.body,
                        ...parsed.data,
                    },
                },
            };
        }),
    },
    databaseHooks: {
        user: {
            create: {
                // Fires for every new user (email/password AND OAuth) right
                // before the DB insert - the one place a username can be set
                // that isn't subject to `input: false` field-stripping (see
                // the `username` additionalField comment above), so this is
                // the single choke point for auto-generating one.
                before: async (user) => {
                    const seed = (typeof user.name === "string" && user.name.trim()) || "user";
                    const username = await resolveUniqueUsername(sanitizeUsername(seed));
                    return { data: { username } };
                },
            },
        },
    },
    user: {
        changeEmail: {
            enabled: true,
            sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
                const html = await renderComponentToHTML(EmailVerificationMail, {
                    userName: user.name,
                    newEmail,
                    verificationUrl: url,
                    expiryHours: 24,
                });
                const { success } = await sendMail(user.email, "Confirm Your Email Change - Ventry", html);
                if (!success) throw new Error("Failed to send email change confirmation");
            },
        },
        additionalFields: {
            isAdmin: {
                type: "boolean",
                required: false,
                defaultValue: false,
                input: false, // not settable by users
            },
            legalName: {
                type: "string",
                required: false,
            },
            // Unique, changeable handle backing /profile/[username]. Set for
            // every new user by databaseHooks.user.create.before below
            // (covers both OAuth and email/password signups at the single
            // pre-insert choke point), and later only via the dedicated
            // username-change endpoint (changeUsername()). `input: false`
            // blocks it from a generic better-auth update-user call, so the
            // 90-day reservation can't be bypassed.
            username: {
                type: "string",
                required: false,
                input: false,
            },
            // Raw "First Last" name from the OAuth profile, captured once at
            // signup as a suggestion for the legalName step in
            // CompleteProfileWizard. Deliberately separate from `legalName`
            // itself: that field is what gates the onboarding wizard (see
            // profileCompletion middleware), so pre-filling it here would let
            // SSO signups skip the wizard entirely.
            // NOT input:false - better-auth's OAuth-profile merge
            // (parseAdditionalUserInputFromProviderProfile) silently drops
            // any additionalField marked input:false before it ever reaches
            // the DB, which would make mapProfileToUser's value below a
            // no-op. Harmless to leave settable-by-client: a user can already
            // freely type any legalName they want via the wizard, so there's
            // nothing to protect here.
            oauthLegalNameSuggestion: {
                type: "string",
                required: false,
            },
            addressLine1: {
                type: "string",
                required: false,
                returned: false,
            },
            addressLine2: {
                type: "string",
                required: false,
                returned: false,
            },
            addressCity: {
                type: "string",
                required: false,
                returned: false,
            },
            addressState: {
                type: "string",
                required: false,
                returned: false,
            },
            addressPostalCode: {
                type: "string",
                required: false,
                returned: false,
            },
            addressCountry: {
                type: "string",
                required: false,
                returned: false,
            }
        }
    },
    account: {
        accountLinking: {
            enabled: true, // Enable - but we control it via allow_oauth_linking cookie
            trustedProviders: ["github", "google"]
        }
    },
    emailVerification: {
        sendOnSignUp: true, // TODO: Set to true
        sendOnSignIn: false,
        expiresIn: 24 * 60 * 60, // 24 hours (correct property name)

        fromEmail: process.env.SMTP_FROM || "<ventry@m-loeffler.de>",
        autoSignInAfterVerification: true,

        sendVerificationEmail: async ({ user, url }) => {
            const verificationUrl = new URL(url);
            const callbackURL = verificationUrl.searchParams.get("callbackURL");
            if (!callbackURL || callbackURL === "/") {
                verificationUrl.searchParams.set("callbackURL", "/?status=email_verified");
            }
            // Send email verification using proper template
            try {
                const verificationHTML = await renderComponentToHTML(EmailVerificationMail, {
                    userName: user.name,
                    verificationUrl: verificationUrl.toString(),
                    expiryHours: 24
                });

                const { success, error } = await sendMail(
                    user.email,
                    "Verify Your Email Address - Ventry",
                    verificationHTML
                );
                
                if (!success) {
                    console.error("Failed to send verification email:", error);
                    throw new Error(`Failed to send verification email: ${error}`);
                }
            } catch (err) {
                console.error("Error sending verification email:", err);
                throw err; // Rethrow to let better-auth handle retries if needed
            }
        }
    },
    database: prismaAdapter(prisma, {
        provider: "postgresql",
        transaction: true
    }),
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
        password: {
            hash: hashPassword,
            verify: verifyPassword
        },
        revokeSessionsOnPasswordReset: true,
        async onPasswordReset(data) {
            console.log("Password reset requested for:", data.user.email);

        },
        async sendResetPassword({ user, url}) {
            // Send password reset email
            try {
                const { success, error } = await sendMail(
                    user.email,
                    "Reset Your Password",
                    `<p>Hi ${user.name || 'there'},</p><p>You requested to reset your password. Click the link below to continue:</p><p><a href="${url}">Reset Password</a></p><p>If you didn't request this, you can safely ignore this email.</p>`
                );
                
                if (!success) {
                    console.error("Failed to send password reset email:", error);
                }
            } catch (err) {
                console.error("Error sending password reset email:", err);
            }
        },
    },
    socialProviders: {
        google: {
            enabled: true,
            prompt: "select_account", // Always choose a google account on login
            clientId: process.env.GOOGLE_CLIENT_ID || "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
            mapProfileToUser(profile) {
                const clamped = clampDisplayName(profile.name);
                return {
                    id: profile.sub,
                    name: clamped,
                    oauthLegalNameSuggestion: clamped,
                    email: profile.email,
                    image: profile.picture,
                    emailVerified: profile.email_verified
                }
            },
            disableSignUp: false // Allow new users to sign up via Google
        },
        github: {
            enabled: true,
            clientId: process.env.GITHUB_CLIENT_ID || "",
            clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
            mapProfileToUser(profile) {
                const clamped = clampDisplayName(profile.name || profile.login);
                return {
                    id: profile.id.toString(),
                    name: clamped,
                    // profile.login is a handle, not a legal name - only suggest
                    // one when GitHub actually gave us a "First Last" name.
                    oauthLegalNameSuggestion: clampDisplayName(profile.name),
                    email: profile.email,
                    image: profile.avatar_url,
                    emailVerified: true // GitHub emails are verified
                }
            },
            disableSignUp: false // Allow new users to sign up via GitHub
        }
    },
    events: {
        signUp: {
            after: async (context: unknown) => {
                // Send welcome email after successful registration
                const { user } = context as { user: { email: string; name: string } };
                
                if (user?.email && user?.name) {
                    try {
                        console.log("🎉 Sending welcome email to new user:", user.email);
                        
                        const welcomeHTML = await renderComponentToHTML(WelcomeMail, {
                            userName: user.name,
                            loginUrl: `${process.env.BETTER_AUTH_URL || process.env.NEXTAUTH_URL || 'https://local.dev:3443'}/login`
                        });

                        const { success, error } = await sendMail(
                            user.email,
                            "Welcome to Ventry!",
                            welcomeHTML
                        );

                        if (success) {
                            console.log("✅ Welcome email sent successfully to:", user.email);
                        } else {
                            console.error("❌ Failed to send welcome email:", error);
                        }
                    } catch (err) {
                        console.error("💥 Error sending welcome email:", err);
                    }
                }
            }
        }
    }
});

export const { POST, GET } = toNextJsHandler(auth);
