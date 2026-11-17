import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL;

let redisClient: Redis | null = null;

function getRedis() {
  if (!redisUrl) {
    throw new Error("REDIS_URL is not configured");
  }

  if (!redisClient) {
    redisClient = new Redis(redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        return Math.min(times * 200, 2_000);
      },
    });

    redisClient.on("error", (error) => {
      console.error("[redis] Connection error:", error.message);
    });
  }

  return redisClient;
}

async function ensureRedis() {
  const redis = getRedis();

  if (redis.status === "wait") {
    await redis.connect();
  }

  return redis;
}

export async function getOrInitProductStock(productId: string, capacity: number, currentSold: number): Promise<boolean> {
  const key = `product:${productId}:stock`;
  const redis = await ensureRedis();
  
  // Try to set the initial available stock (Capacity - Sold)
  // setnx only sets if key doesn't exist
  const available = Math.max(0, capacity - currentSold);
  await redis.setnx(key, available);
  
  // Return true to indicate client is ready
  return true;
}

export async function decrementProductStock(productId: string): Promise<boolean> {
  const key = `product:${productId}:stock`;
  const redis = await ensureRedis();
  
  // Atomic decrement
  const result = await redis.decr(key);
  
  // If result is < 0, we oversold or are empty. 
  // We should increment it back to 0 (or keep it negative to indicate depth of waitlist?)
  // Typically for a simple gatekeeper, if < 0, we rollback and fail.
  
  if (result < 0) {
    await redis.incr(key); // Rollback
    return false;
  }
  
  return true;
}

export async function incrementProductStock(productId: string): Promise<void> {
    const key = `product:${productId}:stock`;
    const redis = await ensureRedis();
    await redis.incr(key);
}

export async function clearProductStock(productId: string): Promise<void> {
    const key = `product:${productId}:stock`;
    const redis = await ensureRedis();
    await redis.del(key);
}

export function isRedisConfigured() {
  return Boolean(redisUrl);
}

export async function publishMessage(channel: string, message: string): Promise<void> {
  const redis = await ensureRedis();
  await redis.publish(channel, message);
}

/** Subscriber connections cannot run normal commands, so they get their own connection. */
export async function createSubscriber(): Promise<Redis> {
  const subscriber = getRedis().duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null });
  subscriber.on("error", (error) => {
    console.error("[redis] Subscriber error:", error.message);
  });
  if (subscriber.status === "wait") {
    await subscriber.connect();
  }
  return subscriber;
}
