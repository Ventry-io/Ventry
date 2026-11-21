import { allBlocks, TELEGRAM_CHANNEL, type PageBlock } from "@/types/schemas/event/page";

export type ChannelPosts = { posts: number[]; nextBefore: number | null };
export class TelegramPreviewError extends Error {}

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Reads the newest post IDs of a public channel from Telegram's web preview (t.me/s/<channel>).
 * The preview cannot be framed, but every single post can be embedded. Cached for 5 minutes.
 */
export async function getChannelPosts(channel: string, before?: number): Promise<ChannelPosts> {
  if (!TELEGRAM_CHANNEL.test(channel)) throw new TelegramPreviewError("Invalid channel name");
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 2)) throw new TelegramPreviewError("Invalid position");
  const response = await fetch(`https://t.me/s/${channel}${before ? `?before=${before}` : ""}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(5_000),
    headers: { "accept-language": "en" },
    next: { revalidate: 300 },
  });
  // t.me/s redirects to the channel page when the channel has no public preview (private, missing or disabled).
  if (response.status !== 200) throw new TelegramPreviewError("This channel has no public web preview");
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_BYTES) throw new TelegramPreviewError("Telegram response too large");
  const html = (await response.text()).slice(0, MAX_BYTES);
  const pattern = new RegExp(`data-post="${channel}/(\\d+)"`, "gi");
  const posts = [...new Set([...html.matchAll(pattern)].map(match => Number(match[1])))]
    .filter(id => Number.isSafeInteger(id) && id > 0)
    .sort((a, b) => b - a);
  if (!posts.length && !before && !/tgme_channel_info/.test(html)) throw new TelegramPreviewError("This channel has no public web preview");
  const oldest = posts.at(-1);
  return { posts, nextBefore: oldest && oldest > 1 ? oldest : null };
}

/** Prefetches every Telegram block of a page in parallel; a failed channel becomes null so the page still renders. */
export async function loadTelegramFeeds(blocks: PageBlock[]): Promise<Record<string, ChannelPosts | null>> {
  const feeds = allBlocks(blocks).flatMap(block => block.type === "telegram" ? [block] : []);
  return Object.fromEntries(await Promise.all(feeds.map(async block => [block.id, await getChannelPosts(block.channel).catch(() => null)] as const)));
}
