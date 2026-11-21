"use client";

import { useEffect, useState } from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import type { ChannelPosts } from "@/lib/events/telegram";

export type TelegramLoader = (before?: number) => Promise<ChannelPosts>;
type Feed = { posts: number[]; nextBefore: number | null };

function TelegramPost({ channel, post }: { channel: string; post: number }) {
  return <Box className="vp-telegram-post">
    <Box component="iframe" title={`Telegram @${channel}, post ${post}`} src={`https://t.me/${channel}/${post}?embed=1&mode=tme`}
      loading="lazy" referrerPolicy="no-referrer" sx={{ width: "100%", height: 420, border: 0 }} />
    <a href={`https://t.me/${channel}/${post}`} target="_blank" rel="noopener noreferrer">Open original Telegram post {post}</a>
  </Box>;
}

/** Newest posts of a public channel as official embeds, plus pinned posts and "load older". */
export default function TelegramFeed({ channel, limit, pinned, initial, load }: {
  channel: string; limit: number; pinned: number[]; initial?: Feed | null; load: TelegramLoader;
}) {
  const [feed, setFeed] = useState<Feed | null>(initial ?? null);
  const [shown, setShown] = useState(limit);
  const [error, setError] = useState(initial === null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initial !== undefined) return;
    let active = true;
    load().then(result => { if (active) setFeed(result); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [initial, load]);

  const more = async () => {
    if (!feed) return;
    if (feed.posts.length > shown) { setShown(shown + limit); return; }
    if (!feed.nextBefore) return;
    setLoading(true);
    try {
      const next = await load(feed.nextBefore);
      setFeed({ posts: [...feed.posts, ...next.posts.filter(id => !feed.posts.includes(id))], nextBefore: next.nextBefore });
      setShown(shown + limit);
    } catch { setError(true); } finally { setLoading(false); }
  };

  const latest = (feed?.posts ?? []).filter(id => !pinned.includes(id)).slice(0, shown);
  const canLoadMore = !!feed && (feed.posts.length > shown || !!feed.nextBefore);
  return <Stack spacing={2} className="vp-telegram">
    <Typography variant="h5" component="h2">Telegram · <a href={`https://t.me/${channel}`} target="_blank" rel="noopener noreferrer">@{channel}</a></Typography>
    {pinned.map(post => <TelegramPost key={`pinned-${post}`} channel={channel} post={post} />)}
    {error && <Alert severity="info">Telegram posts could not load. <a href={`https://t.me/s/${channel}`} target="_blank" rel="noopener noreferrer">Open the channel on Telegram</a>.</Alert>}
    {!feed && !error && <Typography role="status">Loading Telegram posts…</Typography>}
    {latest.map(post => <TelegramPost key={post} channel={channel} post={post} />)}
    {canLoadMore && <Button variant="outlined" onClick={() => void more()} disabled={loading}>{loading ? "Loading…" : "Load older posts"}</Button>}
  </Stack>;
}
