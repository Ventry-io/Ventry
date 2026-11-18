import { Prisma } from "@/generated/prisma/client";
import { recordHealthSignal } from "@/lib/health-signals";

// Driver adapter error kinds (@prisma/driver-adapter-utils) that mean the database itself is unusable.
const INFRA_ADAPTER_KINDS = new Set([
  "DatabaseNotReachable", "DatabaseDoesNotExist", "DatabaseAccessDenied", "AuthenticationFailed",
  "ConnectionClosed", "TlsConnectionError", "TooManyConnections", "SocketTimeout",
]);
// The same failures as Prisma codes, plus Accelerate (P5xxx/P6xxx), whose errors carry no adapter details.
const INFRA_PRISMA_CODES = new Set([
  "P1000", "P1001", "P1002", "P1003", "P1008", "P1010", "P1011", "P1017", "P2024", "P2037",
  "P5011", "P6000", "P6001", "P6002", "P6003", "P6008", "P6010",
]);
// SQLSTATE classes from raw queries: connection, auth, resources, shutdown (57P*, not 57014 statement
// timeout), system and internal errors.
const INFRA_SQLSTATE = /^(08|28|53|57P|58|XX)/;
const NETWORK_ERRNOS = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "EPIPE",
]);

type QueryError = {
  name?: unknown;
  code?: unknown;
  errorCode?: unknown;
  message?: unknown;
  meta?: { driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown } } };
};

/**
 * Returns a safe code when an error means the database is unavailable, or undefined for application
 * errors such as P2002 (unique constraint) or P2025 (record not found).
 */
export function databaseFailureCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const { name, code, errorCode, message, meta } = error as QueryError;
  const cause = meta?.driverAdapterError?.cause;

  if (typeof code === "string" && INFRA_PRISMA_CODES.has(code)) return code;
  // Raw queries wrap adapter errors in the generic P2010.
  if (typeof cause?.kind === "string" && INFRA_ADAPTER_KINDS.has(cause.kind)) return cause.kind;
  if (cause?.kind === "postgres" && typeof cause.originalCode === "string" && INFRA_SQLSTATE.test(cause.originalCode)) {
    return `SQLSTATE_${cause.originalCode}`;
  }
  if (name === "PrismaClientInitializationError") {
    return typeof errorCode === "string" && /^P\d{4}$/.test(errorCode) ? errorCode : "PRISMA_INIT_FAILED";
  }
  if (typeof code === "string" && NETWORK_ERRNOS.has(code)) return code;
  // node-postgres pool and connect failures surface as plain Errors with fixed messages.
  if (typeof message === "string") {
    if (message.startsWith("timeout exceeded when trying to connect") || message.includes("due to connection timeout")) {
      return "PG_CONNECT_TIMEOUT";
    }
    if (message.startsWith("Connection terminated")) return "PG_CONNECTION_TERMINATED";
  }
  return undefined;
}

type Operation = { args: unknown; query: (args: unknown) => Promise<unknown> };

/** Records real query outcomes as the "prisma" health signal without changing results or errors. */
export async function observeQuery({ args, query }: Operation) {
  const startedAt = performance.now();
  let result: unknown;
  try {
    result = await query(args);
  } catch (error) {
    const code = databaseFailureCode(error);
    if (code) {
      record({ success: false, durationMs: elapsed(startedAt), error: "Database query failed", code }, startedAt);
    }
    throw error;
  }
  // Accelerate cache hits never reach the database, so they prove nothing about it.
  if (!(args && typeof args === "object" && "cacheStrategy" in args)) {
    record({ success: true, durationMs: elapsed(startedAt) }, startedAt);
  }
  return result;
}

function elapsed(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

function record(...signal: Parameters<typeof recordHealthSignal> extends [string, ...infer Rest] ? Rest : never) {
  try {
    recordHealthSignal("prisma", ...signal);
  } catch {
    // Monitoring must never break an application query.
  }
}

export const queryHealthExtension = Prisma.defineExtension({
  name: "query-health",
  query: { $allOperations: observeQuery },
});
