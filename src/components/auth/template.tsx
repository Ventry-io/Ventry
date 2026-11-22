"use client";
import type React from "react";
import {
    Box,
    Typography,
    Alert,
} from "@mui/material";
import Link from "next/link";
import MuiLink from "@mui/material/Link";
import ForgotPassword from "./ForgotPassword";
import { useSearchParams } from "next/navigation";
import { getCallbackPath } from "@/lib/auth/callback";

export interface AuthTemplateProps {
    children: React.ReactNode;
    form: "login" | "register";
    title?: string;
    error: string | null;
    resetPasswordOpen?: boolean;
    onClose?: () => void;
}

const AuthTemplate = ({ 
    children, 
    form, 
    error,
    resetPasswordOpen = false,
    onClose = () => void 0
}: AuthTemplateProps) => {

    return (
        // The page around it provides the sheet; nesting another paper here drew a card inside a card.
        <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {error && (
                    <Alert severity="error" sx={{ width: '100%', mb: 2 }}>
                        {error}
                    </Alert>
                )}
                
                {children}
                
                {form === "register" && <AlreadyRegistered />}
                {form === "login" && <ForgotPassword onClose={onClose} open={resetPasswordOpen} />}
        </Box>
    );
};

const AlreadyRegistered = () => {
    return (
        <Box sx={{ mt: 3, textAlign: 'center', width: '100%' }}>
            <Typography variant="body2">
                Already registered?{' '}
                <Link href="/login" passHref>
                    <MuiLink component="span" variant="body2">
                        Login here
                    </MuiLink>
                </Link>
            </Typography>
        </Box>
    );
};

// Rendered by the login page after every sign-in method, so it is the last thing on the form.
export const NotYetRegistered = () => {
    const callbackUrl = getCallbackPath(useSearchParams().get("callbackUrl"));
    return (
        <Box sx={{ mt: 3, textAlign: 'center', width: '100%' }}>
            <Typography variant="body2">
                Not yet registered?{' '}
                <Link href={`/register?callbackUrl=${encodeURIComponent(callbackUrl)}`} passHref>
                    <MuiLink component="span" variant="body2">
                        Register here
                    </MuiLink>
                </Link>
            </Typography>
        </Box>
    );
};

export default AuthTemplate;
