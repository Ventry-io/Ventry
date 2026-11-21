import { EventEmitter } from "node:events";
import { createSubscriber, isRedisConfigured, publishMessage } from "@/lib/redis";

/**
 * Live notification fan-out. createNotification publishes `notifications:<userId>` on Redis so every app
 * instance hears it; each process keeps one pattern subscriber and dispatches to its open SSE streams.
 * Without REDIS_URL it falls back to an in-process emitter (single instance only).
 */
const CHANNEL_PREFIX = "notifications:";
const local = new EventEmitter();
local.setMaxListeners(0);

let subscribing: Promise<void> | null = null;

function ensureSubscribed() {
  if (!isRedisConfigured()) return Promise.resolve();
  subscribing ??= (async () => {
    const subscriber = await createSubscriber();
    subscriber.on("pmessage", (_pattern, channel: string) => {
      local.emit(channel.slice(CHANNEL_PREFIX.length));
    });
    await subscriber.psubscribe(`${CHANNEL_PREFIX}*`);
  })().catch((error) => {
    subscribing = null; // retry on the next stream
    throw error;
  });
  return subscribing;
}

export async function publishNotificationEvent(userId: string) {
  if (!isRedisConfigured()) {
    local.emit(userId);
    return;
  }
  try {
    await publishMessage(`${CHANNEL_PREFIX}${userId}`, "1");
  } catch (error) {
    // Clients still catch up through polling and focus refresh.
    console.error("[notifications] Live publish failed:", error);
  }
}

/** Registers a listener for one user's notifications. Returns the unsubscribe function. */
export async function onNotification(userId: string, listener: () => void) {
  try {
    await ensureSubscribed();
  } catch (error) {
    console.error("[notifications] Live subscribe failed:", error);
  }
  local.on(userId, listener);
  return () => {
    local.off(userId, listener);
  };
}
