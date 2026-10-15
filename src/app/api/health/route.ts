import { prisma } from "@/lib/prisma/prisma";
import { stripe } from "@/lib/stripe";
import { GiphyFetch } from "@giphy/js-fetch-api";
import { healthCheck as supabaseHealthCheck } from "@/lib/supabase";
import { mailTransport } from "@/lib/mail";
import { connection } from "next/server";

type CheckResult = {
  success: boolean;
  durationMs: number;
  error?: string;
  code?: string;
};

const CHECK_TIMEOUT_MS = 10_000;
const configuredCacheTtlMs = Number(process.env.CACHE_TTL_MS);
const CACHE_TTL_MS = Number.isSafeInteger(configuredCacheTtlMs) && configuredCacheTtlMs > 0
  ? configuredCacheTtlMs
  : 30_000;

// ponytail: per-instance cache; use a shared cache with locking for multiple replicas.
let cachedHealth: ReturnType<typeof checkHealth> | undefined;
let cacheExpiresAt = 0;

export async function GET() {
  await connection();
  const health = await getHealth();

  return Response.json(health, {
    status: health.status === "ok" ? 200 : 500,
    headers: { "Cache-Control": "no-store" },
  });
}

function getHealth() {
  if (!cachedHealth || performance.now() >= cacheExpiresAt) {
    cacheExpiresAt = Infinity;
    cachedHealth = checkHealth()
      .then((health) => {
        cacheExpiresAt = performance.now() + CACHE_TTL_MS;
        return health;
      })
      .catch((error) => {
        cachedHealth = undefined;
        throw error;
      });
  }
  return cachedHealth;
}

async function checkHealth() {
  const started = performance.now();
  const checks = {
    prisma: checkPrisma,
    stripe: checkStripe,
    giphy: checkGiphy,
    supabase: checkSupabase,
    mail: checkMail,
  };

  const fuses = Object.fromEntries(
    await Promise.all(
      Object.entries(checks).map(async ([name, check]) => [
        name,
        await runCheck(name, check),
      ] as const),
    ),
  );
  const success = Object.values(fuses).every((check) => check.success);

  return {
    status: success ? "ok" : "error",
    cacheTtlMs: CACHE_TTL_MS,
    timestamp: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    fuses,
  };
}

async function runCheck(name: string, check: () => Promise<unknown>): Promise<CheckResult> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: Omit<CheckResult, "durationMs">;

  try {
    // ponytail: deadline bounds the response; add SDK cancellation when supported.
    const value = await Promise.race([
      check(),
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

  return { ...result, durationMs: Math.round(performance.now() - started) };
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
  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error("Giphy API key not configured"), {
      code: "MISSING_API_KEY",
    });
  }
  const gf = new GiphyFetch(apiKey);
  await gf.trending({ limit: 1, rating: "g" });
  return true;
}

async function checkSupabase() {
  return supabaseHealthCheck();
}

async function checkMail() {
  return mailTransport.verify();
}
