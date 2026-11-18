"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNotificationStream } from "./useNotificationStream";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Popover from "@mui/material/Popover";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import NotificationsIcon from "@mui/icons-material/Notifications";
import Link from "next/link";

type NotificationType = "COMMENT" | "EVENT" | "COMMUNITY" | "SYSTEM";

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

const TABS: { label: string; value: NotificationType | "ALL" }[] = [
  { label: "All", value: "ALL" },
  { label: "Comments", value: "COMMENT" },
  { label: "Events", value: "EVENT" },
  { label: "Community", value: "COMMUNITY" },
  { label: "System", value: "SYSTEM" },
];

// Fallback only: new notifications arrive live through useNotificationStream.
const POLL_INTERVAL_MS = 60_000;

export default function NotificationBell() {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [tab, setTab] = useState<NotificationType | "ALL">("ALL");
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const url =
        tab === "ALL"
          ? "/api/notifications?limit=20"
          : `/api/notifications?limit=20&type=${tab}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as {
        notifications: Notification[];
        unreadCount: number;
      };
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // ignore network errors
    }
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    fetchNotifications().finally(() => setLoading(false));

    timerRef.current = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchNotifications]);

  useNotificationStream(() => {
    void fetchNotifications();
  });

  const markRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const markAllRead = async () => {
    await fetch("/api/notifications/read-all", { method: "PATCH" });
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const clearAll = async () => {
    await fetch("/api/notifications", { method: "DELETE" });
    setNotifications([]);
    setUnreadCount(0);
  };

  const deleteNotification = async (id: string, wasUnread: boolean) => {
    await fetch(`/api/notifications/${id}`, { method: "DELETE" });
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
  };

  const open = Boolean(anchorEl);

  return (
    <>
      <IconButton
        size="small"
        aria-label="Notifications"
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <Badge badgeContent={unreadCount || undefined} color="error" max={99}>
          <NotificationsIcon fontSize="small" />
        </Badge>
      </IconButton>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        PaperProps={{ sx: { width: 380, maxHeight: 520 } }}
      >
        <Box sx={{ px: 2, pt: 2, pb: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            Notifications
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            {unreadCount > 0 && (
              <Button size="small" onClick={markAllRead} sx={{ fontSize: 12 }}>
                Mark all as read
              </Button>
            )}
            {notifications.length > 0 && (
              <Button size="small" color="error" onClick={clearAll} sx={{ fontSize: 12 }}>
                Clear all
              </Button>
            )}
          </Box>
        </Box>

        <Tabs
          value={tab}
          onChange={(_, v: NotificationType | "ALL") => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: "divider", minHeight: 36 }}
          TabIndicatorProps={{ style: { height: 2 } }}
        >
          {TABS.map((t) => (
            <Tab
              key={t.value}
              label={t.label}
              value={t.value}
              sx={{ fontSize: 12, minHeight: 36, py: 0.5 }}
            />
          ))}
        </Tabs>

        <Box sx={{ overflowY: "auto", maxHeight: 360 }}>
          {loading && notifications.length === 0 ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : notifications.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: "center" }}>
              No notifications
            </Typography>
          ) : (
            notifications.map((n, i) => (
              <Paper key={n.id} elevation={0} square>
                {i > 0 && <Divider />}
                <Box
                  sx={{
                    px: 2,
                    py: 1.5,
                    display: "flex",
                    gap: 1,
                    bgcolor: n.read ? "transparent" : "action.hover",
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.selected" },
                  }}
                  onClick={() => !n.read && markRead(n.id)}
                >
                  {!n.read && (
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        bgcolor: "primary.main",
                        mt: 0.75,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    {n.link ? (
                      <Link href={n.link} style={{ textDecoration: "none", color: "inherit" }}>
                        <Typography variant="body2" fontWeight={n.read ? 400 : 600} noWrap>
                          {n.title}
                        </Typography>
                      </Link>
                    ) : (
                      <Typography variant="body2" fontWeight={n.read ? 400 : 600} noWrap>
                        {n.title}
                      </Typography>
                    )}
                    {n.body && (
                      <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {n.body}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.disabled">
                      {new Date(n.createdAt).toLocaleDateString()}
                    </Typography>
                  </Box>
                  <Tooltip title="Delete notification">
                    <IconButton
                      size="small"
                      color="error"
                      sx={{
                        alignSelf: "flex-start",
                        width: 32,
                        height: 32,
                        flexShrink: 0,
                        opacity: 0.75,
                        bgcolor: "action.hover",
                        "&:hover": {
                          opacity: 1,
                          bgcolor: "error.light",
                          color: "error.contrastText",
                        },
                      }}
                      aria-label="Delete notification"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNotification(n.id, !n.read);
                      }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Paper>
            ))
          )}
        </Box>
      </Popover>
    </>
  );
}
