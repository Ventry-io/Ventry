export type HealthCheckResult = {
  success: boolean;
  durationMs: number;
  error?: string;
  code?: string;
};

const configuredTtlMs = Number(process.env.GIPHY_CACHE_TTL_MS);
const GIPHY_CACHE_TTL_MS = Number.isSafeInteger(configuredTtlMs) && configuredTtlMs > 0
  ? configuredTtlMs
  : 5 * 60_000;

// ponytail: shared across routes in one process; use a shared store for multiple replicas.
const shared = globalThis as typeof globalThis & {
  ventryGiphyHealth?: { result: HealthCheckResult; expiresAt: number };
};

export function getGiphyHealth() {
  const cached = shared.ventryGiphyHealth;
  return cached && performance.now() < cached.expiresAt ? cached.result : undefined;
}

export function recordGiphyHealth(result: HealthCheckResult) {
  shared.ventryGiphyHealth = {
    result,
    expiresAt: performance.now() + GIPHY_CACHE_TTL_MS,
  };
}
