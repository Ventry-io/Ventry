// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { getHealthSignal } from "@/lib/health-signals";
import { databaseFailureCode, observeQuery } from "./query-health";

const clientVersion = "7.10.1";
// Shapes match what Prisma 7.10 with @prisma/adapter-pg throws (verified against a local Postgres).
const known = (code: string, cause?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError("Sensitive SELECT * FROM users WHERE email = 'a@b.c'", {
  code, clientVersion, meta: cause ? { driverAdapterError: { cause } } : {},
});
const signal = () => getHealthSignal("prisma", 60 * 60_000, 60_000);

describe("databaseFailureCode", () => {
  it.each([
    ["model query, server unreachable", known("P1001", { kind: "DatabaseNotReachable" }), "P1001"],
    ["model query, wrong password", known("P1000", { kind: "AuthenticationFailed", originalCode: "28P01" }), "P1000"],
    ["model query, missing database", known("P1003", { kind: "DatabaseDoesNotExist", originalCode: "3D000" }), "P1003"],
    ["raw query, server unreachable", known("P2010", { kind: "DatabaseNotReachable" }), "DatabaseNotReachable"],
    ["raw query, wrong password", known("P2010", { kind: "AuthenticationFailed", originalCode: "28P01" }), "AuthenticationFailed"],
    ["too many connections", known("P2037", { kind: "TooManyConnections" }), "P2037"],
    ["socket timeout", known("P2010", { kind: "SocketTimeout" }), "SocketTimeout"],
    ["connection closed", known("P2010", { kind: "ConnectionClosed" }), "ConnectionClosed"],
    ["raw query, admin shutdown", known("P2010", { kind: "postgres", originalCode: "57P01" }), "SQLSTATE_57P01"],
    ["raw query, out of connections", known("P2010", { kind: "postgres", originalCode: "53300" }), "SQLSTATE_53300"],
    ["Accelerate engine connection error", known("P6008"), "P6008"],
    ["client initialization", new Prisma.PrismaClientInitializationError("boom", clientVersion, "P1001"), "P1001"],
    ["pg pool exhausted", new Error("timeout exceeded when trying to connect"), "PG_CONNECT_TIMEOUT"],
    ["pg connect timeout", new Error("Connection terminated due to connection timeout"), "PG_CONNECT_TIMEOUT"],
    ["pg connection lost", new Error("Connection terminated unexpectedly"), "PG_CONNECTION_TERMINATED"],
    ["network errno", Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }), "ECONNREFUSED"],
  ])("treats %s as a database failure", (_label, error, code) => {
    expect(databaseFailureCode(error)).toBe(code);
  });

  it.each([
    ["unique constraint", known("P2002", { kind: "UniqueConstraintViolation", originalCode: "23505" })],
    ["record not found", known("P2025")],
    ["foreign key", known("P2003", { kind: "ForeignKeyConstraintViolation" })],
    ["expired interactive transaction", known("P2028")],
    ["write conflict", known("P2034", { kind: "TransactionWriteConflict" })],
    ["raw syntax error", known("P2010", { kind: "postgres", originalCode: "42601" })],
    ["raw statement timeout", known("P2010", { kind: "postgres", originalCode: "57014" })],
    ["validation error", new Prisma.PrismaClientValidationError("bad args", { clientVersion })],
    ["plain application error", new Error("Something else")],
    ["non-error", "oops"],
  ])("does not treat %s as a database failure", (_label, error) => {
    expect(databaseFailureCode(error)).toBeUndefined();
  });
});

describe("observeQuery", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance", "Date"] });
    vi.stubGlobal("ventryHealthSignals", undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the query result unchanged and records a success", async () => {
    const result = { id: "1" };
    await expect(observeQuery({ args: { where: {} }, query: async () => result })).resolves.toBe(result);
    expect(signal()).toMatchObject({ success: true });
  });

  it("rethrows the original infrastructure error and records only a safe code", async () => {
    const error = known("P1001", { kind: "DatabaseNotReachable" });
    await expect(observeQuery({ args: {}, query: () => Promise.reject(error) })).rejects.toBe(error);
    const recorded = signal();
    expect(recorded).toMatchObject({ success: false, code: "P1001", error: "Database query failed" });
    expect(JSON.stringify(recorded)).not.toMatch(/SELECT|email|a@b\.c/);
  });

  it.each(["P2002", "P2025"])("does not mark the database unhealthy for %s", async (code) => {
    const error = known(code);
    await expect(observeQuery({ args: {}, query: () => Promise.reject(error) })).rejects.toBe(error);
    expect(signal()).toBeUndefined();
  });

  it("recovers on the next successful query", async () => {
    await observeQuery({ args: {}, query: () => Promise.reject(known("P1001")) }).catch(() => {});
    vi.advanceTimersByTime(1);
    await observeQuery({ args: {}, query: async () => [] });
    expect(signal()).toMatchObject({ success: true });
  });

  it("keeps the failure when a slower query that started earlier succeeds afterwards", async () => {
    let finishSlow: (value: unknown) => void = () => {};
    const slow = observeQuery({ args: {}, query: () => new Promise((resolve) => { finishSlow = resolve; }) });
    vi.advanceTimersByTime(1);
    await observeQuery({ args: {}, query: () => Promise.reject(known("P1001")) }).catch(() => {});
    vi.advanceTimersByTime(1);
    finishSlow([]);
    await slow;
    expect(signal()).toMatchObject({ success: false, code: "P1001" });
  });

  it("does not count Accelerate cache hits as database proof", async () => {
    await observeQuery({ args: { cacheStrategy: { ttl: 60 } }, query: async () => [] });
    expect(signal()).toBeUndefined();
  });

  it("never lets a broken health store interfere with the query", async () => {
    const broken = () => { throw new Error("store broken"); };
    vi.stubGlobal("ventryHealthSignals", { get: broken, set: broken });
    const result = { id: "1" };
    await expect(observeQuery({ args: {}, query: async () => result })).resolves.toBe(result);
    const error = known("P1001");
    await expect(observeQuery({ args: {}, query: () => Promise.reject(error) })).rejects.toBe(error);
  });
});
