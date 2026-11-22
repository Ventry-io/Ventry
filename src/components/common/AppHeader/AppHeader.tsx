"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppBar from "@mui/material/AppBar";
import Alert from "@mui/material/Alert";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import { kissCut } from "@/lib/ui/kissCut";
import { BRAND_NAME } from "@/lib/brand";
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
 * - Left: sticker mark plus the deployment's brand name (BRAND_NAME) → homepage.
 * - Right: login/logout button plus profile avatar icon (when signed in) → /profile.
 */
export default function AppHeader() {
    const { data: session } = useSession();
    const user = session?.user ?? null;

    const pathname = usePathname();

    const [visible, setVisible] = useState(true);
    const [hasHealthIssues, setHasHealthIssues] = useState(false);
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

    useEffect(() => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        let pollIntervalMs = 10_000;

        const checkHealth = async () => {
            if (!document.hidden) {
                try {
                    const response = await fetch("/api/health", {
                        cache: "no-store",
                        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
                    });
                    const data: { status?: unknown; cacheTtlMs?: unknown } | null = await response.json();
                    if (!controller.signal.aborted) {
                        if (typeof data?.cacheTtlMs === "number" && Number.isSafeInteger(data.cacheTtlMs) && data.cacheTtlMs > 0) {
                            pollIntervalMs = Math.min(data.cacheTtlMs, 2_147_483_647);
                        }
                        setHasHealthIssues(!response.ok || data?.status !== "ok");
                    }
                } catch {
                    if (!controller.signal.aborted) setHasHealthIssues(true);
                }
            }

            if (!controller.signal.aborted) timer = setTimeout(checkHealth, pollIntervalMs);
        };

        void checkHealth();
        return () => {
            controller.abort();
            clearTimeout(timer);
        };
    }, []);

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
            position="sticky"
            sx={{
                zIndex: theme => theme.zIndex.drawer + 1,
                top: 0,
                left: 0,
                right: 0,
                transform: visible ? "translateY(0)" : "translateY(-100%)",
                transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                color: "text.primary",
            }}
        >
            <Toolbar sx={{ justifyContent: "space-between", gap: 2, minHeight: { xs: 60, sm: 64 } }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
                    <Box component={Link} href="/" sx={{ display: "inline-flex", alignItems: "center", gap: 1.25, color: "inherit", textDecoration: "none", borderRadius: 2 }}>
                        <Box aria-hidden sx={{ ...kissCut, width: 32, height: 32, borderRadius: "50%", bgcolor: "var(--ink-teal)", color: "background.paper", display: "grid", placeItems: "center", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1rem", flexShrink: 0 }}>
                            {BRAND_NAME[0]}
                        </Box>
                        <Typography component="span" sx={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.375rem", letterSpacing: "-0.01em", userSelect: "none" }}>
                            {BRAND_NAME}
                        </Typography>
                    </Box>

                    {user?.isAdmin && (
                        <Chip
                            component={Link}
                            href={isInAdminArea ? "/" : "/admin"}
                            clickable
                            color="secondary"
                            size="small"
                            aria-label={isInAdminArea ? "Leave admin area" : "Admin"}
                            label={isInAdminArea ? <><Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>Leave admin area</Box><Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>Site</Box></> : "Admin"}
                        />
                    )}
                </Box>

                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                    {!isOnLoginOrLogout && <Button
                        component={Link}
                        href={user ? "/logout" : "/login"}
                        variant={user ? "text" : "contained"}
                        size="small"
                    >
                        {user ? "Logout" : "Login"}
                    </Button>}

                    {user && <NotificationBell />}

                    {user ? (
                        <Link href="/profile" style={{ textDecoration: "none" }}>
                            <IconButton size="small" sx={{ p: 0, borderRadius: "50%" }} aria-label="Go to profile">
                                <Avatar
                                    alt={user.name ?? "Profile"}
                                    src={profileImageUrl ?? undefined}
                                    sx={{ width: 38, height: 38, fontSize: "0.875rem", bgcolor: "var(--ink-grape)", color: "background.paper" }}
                                >
                                    {!profileImageUrl && initials}
                                </Avatar>
                            </IconButton>
                        </Link>
                    ) : null}
                </Box>
            </Toolbar>
            {hasHealthIssues && (
                <Alert severity="warning" sx={{ borderRadius: 0 }}>
                    We might experience some issues right now.
                </Alert>
            )}
        </AppBar>
    );
}
