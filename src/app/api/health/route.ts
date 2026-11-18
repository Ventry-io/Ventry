import { prisma } from "@/lib/prisma/prisma";
import { stripe } from "@/lib/stripe";
import { GiphyFetch } from "@giphy/js-fetch-api";
import { healthCheck as supabaseHealthCheck } from "@/lib/supabase";
import { mailTransport } from "@/lib/mail";
import { connection } from "next/server";
import { getHealthSignal, recordHealthSignal, type HealthCheckResult as CheckResult } from "@/lib/health-signals";
import { checkPostgresReady } from "@/lib/pg-isready";
import { pingRedis } from "@/lib/redis";

const CHECK_TIMEOUT_MS = 10_000;
const configuredCacheTtlMs = Number(process.env.CACHE_TTL_MS);
const CACHE_TTL_MS = Number.isSafeInteger(configuredCacheTtlMs) && configuredCacheTtlMs > 0
  ? configuredCacheTtlMs
  : 30_000;
// SELECT 1 may be a billable Prisma Postgres operation, so one success, from real traffic or the probe,
// stays valid for an hour.
const SQL_MAX_AGE_MS = 60 * 60_000;
// pg_isready and Redis PING; also the longest a failure is cached before retrying.
const DEPENDENCY_MAX_AGE_MS = 60_000;
const configuredGiphyTtlMs = Number(process.env.GIPHY_CACHE_TTL_MS);
const GIPHY_CACHE_TTL_MS = Number.isSafeInteger(configuredGiphyTtlMs) && configuredGiphyTtlMs > 0
  ? configuredGiphyTtlMs
  : 5 * 60_000;

type Dependency = {
  /** Required dependencies turn the overall status into "error"; optional ones into "degraded". */
  required: boolean;
  /** A success older than this is never reported as healthy; the check is rerun instead. */
  maxAgeMs: number;
  /** Optional integrations are "disabled", not failed, while this env var is empty. */
  enabledBy?: string;
  /**
   * Real traffic records signals (Prisma query extension, Giphy searches); the check only probes when
   * no signal is recent. A failure stays authoritative for this long before a probe retries.
   */
  observed?: { failureMaxAgeMs: number };
  check: () => unknown;
};

const DEPENDENCIES: Record<string, Dependency> = {
  prisma: {
    required: true, maxAgeMs: SQL_MAX_AGE_MS, observed: { failureMaxAgeMs: DEPENDENCY_MAX_AGE_MS }, check: checkPrisma,
  },
  postgres: { required: true, maxAgeMs: DEPENDENCY_MAX_AGE_MS, check: () => checkPostgresReady() },
  // Ticket stock reservation needs Redis, so a missing REDIS_URL is a failure, not "disabled".
  redis: { required: true, maxAgeMs: DEPENDENCY_MAX_AGE_MS, check: pingRedis },
  stripe: { required: false, maxAgeMs: CACHE_TTL_MS, enabledBy: "STRIPE_SECRET_KEY", check: checkStripe },
  giphy: {
    required: false, maxAgeMs: GIPHY_CACHE_TTL_MS, enabledBy: "GIPHY_API_KEY",
    observed: { failureMaxAgeMs: GIPHY_CACHE_TTL_MS }, check: checkGiphy,
  },
  supabase: { required: false, maxAgeMs: CACHE_TTL_MS, enabledBy: "SUPABASE_URL", check: checkSupabase },
  mail: { required: false, maxAgeMs: CACHE_TTL_MS, enabledBy: "SMTP_HOST", check: checkMail },
};

// shortcut: per-process cache, so each replica runs its own checks; share it via Redis if replicas are added.
const checkCache = new Map<string, { result: Promise<CheckResult>; expiresAt: number }>();
const runningChecks = new Set<string>();

export async function GET() {
  await connection();
  const started = performance.now();
  const fuses = Object.fromEntries(await Promise.all(
    Object.entries(DEPENDENCIES).map(async ([name, dependency]) => {
      const result = await getResult(name, dependency);
      return [name, { ...result, required: dependency.required, status: dependencyStatus(dependency, result) }] as const;
    }),
  ));
  const failing = (name: string) => fuses[name].status !== "healthy" && fuses[name].status !== "disabled";
  const names = Object.keys(fuses);
  const status = names.some((name) => DEPENDENCIES[name].required && failing(name))
    ? "error"
    : names.some(failing) ? "degraded" : "ok";

  // Non-2xx for "degraded" too, so Docker and deploy checks never treat a partial outage as healthy.
  return Response.json({
    status,
    cacheTtlMs: CACHE_TTL_MS,
    timestamp: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    fuses,
  }, {
    status: status === "ok" ? 200 : 500,
    headers: { "Cache-Control": "no-store" },
  });
}

function getResult(name: string, dependency: Dependency): Promise<CheckResult> {
  if (dependency.enabledBy && !process.env[dependency.enabledBy]) {
    return Promise.resolve({ success: false, durationMs: 0, code: "NOT_CONFIGURED" });
  }
  if (dependency.observed) return getObservedResult(name, dependency, dependency.observed.failureMaxAgeMs);
  return cachedCheck(name, dependency.check, dependency.maxAgeMs);
}

async function getObservedResult(name: string, dependency: Dependency, failureMaxAgeMs: number) {
  const recent = () => getHealthSignal(name, dependency.maxAgeMs, failureMaxAgeMs);
  const observed = recent();
  if (observed) return observed;

  // Deduplicated probe; the signal store is the cache. The Prisma probe records itself via the query
  // extension, so only outcomes the extension cannot see (timeouts, mocked clients) are recorded here.
  const probeStartedAt = performance.now();
  const result = await cachedCheck(name, dependency.check, 0);
  return recent() ?? recordHealthSignal(name, result, probeStartedAt);
}

function dependencyStatus(dependency: Dependency, result: CheckResult) {
  if (result.code === "NOT_CONFIGURED" || result.code === "PG_ISREADY_NOT_APPLICABLE") return "disabled";
  if (result.code === "PG_ISREADY_MISSING") return "unknown";
  if (!result.success) return "unavailable";
  // Defense in depth: never let an expired success count, whatever cache it came from.
  const ageMs = Date.now() - Date.parse(result.checkedAt ?? "");
  return ageMs <= dependency.maxAgeMs ? "healthy" : "stale";
}

/**
 * Reuses a result until it expires, then makes callers wait for a fresh, deduplicated check.
 * Runs at most once per `maxAgeMs` while healthy and once per minute while failing.
 */
function cachedCheck(name: string, check: () => unknown, maxAgeMs: number) {
  const cached = checkCache.get(name);
  if (cached && performance.now() < cached.expiresAt) return cached.result;

  const entry = { result: runCheck(name, check), expiresAt: Infinity };
  checkCache.set(name, entry);
  void entry.result.then((result) => {
    entry.expiresAt = performance.now() + (result.success ? maxAgeMs : Math.min(maxAgeMs, DEPENDENCY_MAX_AGE_MS));
  });
  return entry.result;
}

async function runCheck(name: string, check: () => unknown): Promise<CheckResult> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: Omit<CheckResult, "durationMs">;

  try {
    // A timed-out check keeps running without SDK cancellation; never stack another one on top.
    if (runningChecks.has(name)) {
      throw Object.assign(new Error(`Previous ${name} health check is still running`), { code: "HEALTH_CHECK_STILL_RUNNING" });
    }
    runningChecks.add(name);
    const pending = new Promise((resolve) => resolve(check())).finally(() => runningChecks.delete(name));
    const value = await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(
          new Error(`Health check timed out after ${CHECK_TIMEOUT_MS}ms`),
          { code: "HEALTH_CHECK_TIMEOUT" },
        )), CHECK_TIMEOUT_MS);
      }),
    ]);
    if (value === false) throw new Error("Health check returned false");
    result = { success: true };
  } catch (error) {
    console.error(`Health check ${name} failed:`, error);
    // Provider messages can contain credentials or connection strings.
    const code = error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
    result = {
      success: false,
      error: `Health check ${name} failed`,
      ...(typeof code === "string" && /^[A-Za-z0-9_]{1,64}$/.test(code) ? { code } : {}),
    };
  } finally {
    clearTimeout(timer);
  }

  return { ...result, durationMs: Math.round(performance.now() - started), checkedAt: new Date().toISOString() };
}

async function checkPrisma() {
  await prisma.$queryRaw`SELECT 1`;
  return true;
}

async function checkStripe() {
  await stripe.accounts.retrieve();
  return true;
}

async function checkGiphy() {
  // GIPHY_API_KEY is checked by `enabledBy` before this runs.
  const gf = new GiphyFetch(process.env.GIPHY_API_KEY ?? "");
  await gf.trending({ limit: 1, rating: "g" });
  return true;
}

async function checkSupabase() {
  return supabaseHealthCheck();
}

async function checkMail() {
  return mailTransport.verify();
}
