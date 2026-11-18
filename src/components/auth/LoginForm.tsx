"use client";

import type React from "react";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import ky from "ky";
import {
    Box,
    Button,
    TextField,
    InputAdornment,
    IconButton,
    CircularProgress,
    Icon
} from "@mui/material";
import { Visibility, VisibilityOff, CheckCircle } from "@mui/icons-material";
import AuthTemplate from "./template";
import { green } from "@mui/material/colors";
import type { PendingAccountLink } from "@/generated/prisma";
import authClient from "@/lib/auth/client";
import LastUsedIndicator from "./LastUsedIndicator";
import { getCallbackPath } from "@/lib/auth/callback";

export default function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
    const [formData, setFormData] = useState({
        email: "",
        password: ""
    });
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, _setRememberMe] = useState(false);

    const [passwordForgetOpen, setPasswordForgetOpen] = useState(false);
    const handlePasswordForgetClose = () => setPasswordForgetOpen(false);

    const router = useRouter();

    const doPasskeyLogin = async () => {
        setError("");
        try {
            setLoading(true);

            const { error } = await authClient.signIn.passkey();
            if (error) {
                const message = error.message || error.statusText || "Passkey authentication failed";
                const status = error.status ? ` (${error.status})` : "";
                setError(`${message}${status}`);
                return;
            }

            // After successful passkey login, redirect
            router.push(callbackUrl ?? "/");
        } catch (err) {
            console.error("Passkey login failed", err);
            setError("Passkey login failed");
        } finally {
            setLoading(false);
        }
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {

            const { error } = await authClient.signIn.email({
                email: formData.email,
                password: formData.password,
                rememberMe: rememberMe
            })
            if(error) {
                setError(error.message ?? error.statusText);
                setLoading(false);
                return;
            }

            setSuccess(true);

            // Wait a bit for session to be established
            await new Promise(resolve => setTimeout(resolve, 500));

            // Check for pending account links
            try {
                const pendingResponse = await ky.get<{pendingLinks: PendingAccountLink[]}>("/api/user/link-account/pending", {
                    cache: 'no-store',
                    headers: {
                        'Cache-Control': 'no-cache'
                    }
                });
                
                if (pendingResponse.ok) {
                    const data = await pendingResponse.json();
                    const pendingLinks = data.pendingLinks;
                    
                    if (Array.isArray(pendingLinks) && pendingLinks.length > 0) {
                        // Redirect to link-account page immediately without query params
                        router.push("/link-account");
                        return;
                    }
                }
            } catch (fetchError) {
                console.error("Error checking pending links:", fetchError);
            }

            // No pending links, go to home or callback URL
            router.push(getCallbackPath(callbackUrl));

        } catch(err: unknown) {
            if(err instanceof Error) {
                setError(err.message || "An error occurred");
            }
        } finally {
            setLoading(false);
        }
    }

    const buttonColor = success ? "success" : "primary";

    const buttonSx = {
        mt: 3,
        mb: 2,
        py: 1.5,
        height: "48px",
        position: "relative",
        transition: "background-color 0.3s, color 0.3s",
        // Override disabled styles when in success state
        "&.Mui-disabled": {
            backgroundColor: "primary.main",
            color: "white"
        }
    };

    const progressSx = {
        color: success ? green[500] : "inherit",
        position: "absolute",
        top: "50%",
        left: "50%",
        marginTop:  "-12px",
        marginLeft: "-12px",
    };

    return (
        <AuthTemplate form="login" error={error} onClose={handlePasswordForgetClose} resetPasswordOpen={passwordForgetOpen}>
            <Box component="form" onSubmit={handleSubmit} noValidate sx={{ width: '100%' }}>
                <TextField
                    margin="normal"
                    required
                    fullWidth
                    id={useId()}
                    label="E-Mail"
                    name="email"
                    autoComplete="email"
                    value={formData.email}
                    onChange={handleChange}
                />
                
                <TextField
                    margin="normal"
                    required
                    fullWidth
                    name="password"
                    label="Password"
                    type={showPassword ? 'text' : 'password'}
                    id={useId()}
                    autoComplete="current-password"
                    value={formData.password}
                    onChange={handleChange}
                    slotProps={{
                        input: {
                            endAdornment: (
                            <InputAdornment position="end">
                                <IconButton
                                    aria-label="toggle password visibility"
                                    onClick={() => setShowPassword(!showPassword)}
                                    edge="end"
                                >
                                    {showPassword ? <VisibilityOff /> : <Visibility />}
                                </IconButton>
                            </InputAdornment>
                        ),
                        }
                    }}
                />
                <LastUsedIndicator loginMethod="email" />
                {error && (
                    <Button href={`/check-email?email=${encodeURIComponent(formData.email)}&callbackUrl=${encodeURIComponent(getCallbackPath(callbackUrl))}`}>
                        Need a new email confirmation link?
                    </Button>
                )}
                <Button
                    // type={(loading || success) ? "button" : "submit"}
                    type="submit"
                    fullWidth
                    variant="contained"
                    color={buttonColor}
                    sx={buttonSx}
                    disabled={loading || success}
                >
                    <span style={{
                        visibility: (loading || success) ? "hidden" : "visible",
                        position: (loading || success) ? "absolute" : "static",
                    }}>
                        Login
                    </span>
                    {loading && <CircularProgress size={24} sx={progressSx} />}
                    {success && <CheckCircle sx={{ ...progressSx, animation: "scale 0.3s"}} />}
                </Button>

                <Button onClick={() => setPasswordForgetOpen(true)}>
                    Reset Password
                </Button>

                <LoginMethodBox>
                    <Button onClick={() => void doPasskeyLogin()} disabled={loading || success} className="w-full rounded-xl border px-4 py-2">
                    <Icon className="fa-solid fa-fingerprint" sx={{ mr: 1 }} />
                        Login with Passkey
                    </Button>
                    {!success && <LastUsedIndicator loginMethod="passkey" />}
                </LoginMethodBox>
            </Box>
        </AuthTemplate>
    );
}


function LoginMethodBox({ children }: { children: React.ReactNode }) {
    return <Box sx={{ mt: 2, display: "flex", flexDirection: "row", gap: 2}}>
        {children}
    </Box>
}
