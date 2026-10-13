"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "next/link";
import { useSession } from "@/lib/auth/client";
import { usePathname } from "next/navigation";
import NotificationBell from "@/components/common/NotificationBell/NotificationBell";
import { PROFILE_PICTURE_CHANGED_EVENT } from "@/lib/user/profilePictureEvents";

type ProfilePictureEntry = { signedUrl: string | null; isPrimary: boolean; order: number };
type ProfilePictureResponse = { profilePictures?: ProfilePictureEntry[] };

/**
 * AppHeader – persistent sticky navigation bar.
 *
 * - Fades out (slides up) when the user scrolls down.
 * - Fades back in when the user scrolls up.
 * - Left: "Ventry" typography brand link → homepage.
 * - Right: login/logout button plus profile avatar icon (when signed in) → /profile.
 */
export default function AppHeader() {
    const { data: session } = useSession();
    const user = session?.user ?? null;

    const pathname = usePathname();

    const [visible, setVisible] = useState(true);
    const lastScrollY = useRef(0);
    // `user.image` is the raw OAuth-provider avatar URL, set at signup
    // regardless of whether the user ever opts in to importing it (see the
    // "Import this as my profile picture" checkbox in CompleteProfileWizard).
    // It must never be used as a display fallback here - only an actual
    // `ProfilePicture` row (created via that opt-in import, or a manual
    // upload) means the user has chosen an avatar. No picture yet -> initials.
    const [profilePictureState, setProfilePictureState] = useState<{ userId: string; url: string | null } | null>(null);
    const profileImageUrl = profilePictureState && profilePictureState.userId === user?.id
        ? profilePictureState.url
        : null;

    const userId = user?.id;
    const fetchProfilePicture = useCallback((signal?: AbortSignal) => {
        if (!userId) {
            return;
        }

        fetch(`/api/user/profile-picture?userId=${encodeURIComponent(userId)}`, { signal })
            .then(r => r.ok ? r.json() as Promise<ProfilePictureResponse> : null)
            .then(data => {
                const pics = data?.profilePictures ?? [];
                const primary = pics.find(p => p.isPrimary) ?? pics[0] ?? null;
                setProfilePictureState({ userId, url: primary?.signedUrl ?? null });
            })
            .catch((error: unknown) => {
                if (error instanceof DOMException && error.name === "AbortError") {
                    return;
                }

                setProfilePictureState({ userId, url: null });
            });
    }, [userId]);

    useEffect(() => {
        const controller = new AbortController();
        fetchProfilePicture(controller.signal);
        return () => controller.abort();
    }, [fetchProfilePicture]);

    // The gallery (upload/set-primary/delete/reorder) and the onboarding
    // OAuth-avatar import both live outside this component and mutate the
    // same ProfilePicture rows - this event is how they tell the header to
    // refetch instead of showing a stale avatar until the next full reload.
    useEffect(() => {
        const handler = () => fetchProfilePicture();
        window.addEventListener(PROFILE_PICTURE_CHANGED_EVENT, handler);
        return () => window.removeEventListener(PROFILE_PICTURE_CHANGED_EVENT, handler);
    }, [fetchProfilePicture]);

    useEffect(() => {
        const handleScroll = () => {
            const currentScrollY = window.scrollY;
            setVisible(currentScrollY <= lastScrollY.current || currentScrollY < 10);
            lastScrollY.current = currentScrollY;
        };

        window.addEventListener("scroll", handleScroll, { passive: true });

        
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);
    
    const isOnLoginOrLogout = pathname === "/login" || pathname === "/logout";
    const isInAdminArea = pathname.startsWith("/admin");

    const initials = user?.name
        ? user.name
              .split(" ")
              .map((n) => n[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)
        : "?";

    return (
        <AppBar
            position="fixed"
            elevation={1}
            sx={{
                zIndex: theme => theme.zIndex.drawer + 1,
                top: 0,
                left: 0,
                right: 0,
                transform: visible ? "translateY(0)" : "translateY(-100%)",
                opacity: visible ? 1 : 0,
                transition: "transform 0.3s ease, opacity 0.3s ease",
                bgcolor: "background.paper",
                color: "text.primary",
                backdropFilter: "blur(8px)",
            }}
        >
            <Toolbar sx={{ justifyContent: "space-between" }}>
                {/* Brand */}
                
                <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>

                    <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
                        <Typography
                            variant="h5"
                            component="span"
                            fontWeight={700}
                            letterSpacing={2}
                            sx={{
                                userSelect: "none",
                                "&:hover": { opacity: 0.8 },
                                transition: "opacity 0.2s",
                            }}
                            >
                            Ventry
                        </Typography>
                    </Link>

                    {user?.isAdmin && (
                        <Link href={isInAdminArea ? "/" : "/admin"} aria-label={isInAdminArea ? "Leave admin area" : "Admin"} style={{ textDecoration: "none" }}>
                            <Typography
                                variant="h6"
                                sx={{ color: "#f50057", fontWeight: "bold", "&:hover": { opacity: 0.8 }, transition: "opacity 0.2s", boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)" }}
                            >
                                {isInAdminArea ? <><Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>← Leave admin area</Box><Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>Site</Box></> : "Admin"}
                            </Typography>
                        </Link>
                    )}
                </Box>
                

                {/* Right side */}
                 <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                    {!isOnLoginOrLogout && <Button
                        component={Link}
                        href={user ? "/logout" : "/login"}
                        variant="outlined"
                        size="small"
                    >
                        {user ? "Logout" : "Login"}
                    </Button>}

                    {user && <NotificationBell />}

                    {user ? (
                        <Link href="/profile" style={{ textDecoration: "none" }}>
                            <IconButton size="small" sx={{ p: 0 }} aria-label="Go to profile">
                                <Avatar
                                    alt={user.name ?? "Profile"}
                                    src={profileImageUrl ?? undefined}
                                    sx={{ width: 36, height: 36, fontSize: "0.875rem" }}
                                >
                                    {!profileImageUrl && initials}
                                </Avatar>
                            </IconButton>
                        </Link>
                    ) : null}
                </Box>
            </Toolbar>
        </AppBar>
    );
}
