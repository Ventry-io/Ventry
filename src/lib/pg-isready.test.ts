import { beforeEach, describe, expect, it, vi } from "vitest";

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ default: { execFile }, execFile }));

import { checkPostgresReady } from "./pg-isready";

type Callback = (error: (Error & { code?: unknown; killed?: boolean }) | null) => void;
const exitWith = (error: Parameters<Callback>[0]) =>
  execFile.mockImplementation((_cmd, _args, _opts, callback: Callback) => callback(error));

describe("checkPostgresReady", () => {
  beforeEach(() => { execFile.mockReset(); });

  it("probes host and port only, never credentials", async () => {
    exitWith(null);
    await expect(checkPostgresReady("postgresql://user:s3cret@db.internal:6543/ventry?schema=dev")).resolves.toBe(true);
    const [command, args, options] = execFile.mock.calls[0];
    expect(command).toBe("pg_isready");
    expect(args).toEqual(["-h", "db.internal", "-p", "6543", "-t", "3"]);
    expect(options).toEqual({ timeout: 5_000 });
    expect(JSON.stringify(execFile.mock.calls[0])).not.toMatch(/s3cret|user/);
  });

  it("defaults the port and unwraps IPv6 hosts", async () => {
    exitWith(null);
    await checkPostgresReady("postgres://u:p@[::1]/ventry");
    expect(execFile.mock.calls[0][1]).toEqual(["-h", "::1", "-p", "5432", "-t", "3"]);
  });

  it.each([
    [1, "PG_ISREADY_REJECTING"],
    [2, "PG_ISREADY_NO_RESPONSE"],
    [3, "PG_ISREADY_INVALID"],
    [127, "PG_ISREADY_FAILED"],
  ])("maps exit code %i to %s", async (exitCode, code) => {
    exitWith(Object.assign(new Error("Command failed: pg_isready -h db.internal"), { code: exitCode }));
    const error = await checkPostgresReady("postgres://u:p@db.internal/ventry").catch((e) => e);
    expect(error.code).toBe(code);
    expect(error.message).not.toContain("db.internal");
  });

  it("reports a timeout when the process is killed", async () => {
    exitWith(Object.assign(new Error("killed"), { code: null, killed: true }));
    await expect(checkPostgresReady("postgres://u:p@db/x")).rejects.toMatchObject({ code: "PG_ISREADY_TIMEOUT" });
  });

  it("reports a missing pg_isready binary", async () => {
    exitWith(Object.assign(new Error("spawn pg_isready ENOENT"), { code: "ENOENT" }));
    await expect(checkPostgresReady("postgres://u:p@db/x")).rejects.toMatchObject({ code: "PG_ISREADY_MISSING" });
  });

  it.each(["prisma://accelerate.prisma-data.net/?api_key=k", "prisma+postgres://localhost:51213/?api_key=k"])(
    "does not probe Accelerate URLs: %s",
    async (url) => {
      await expect(checkPostgresReady(url)).rejects.toMatchObject({ code: "PG_ISREADY_NOT_APPLICABLE" });
      expect(execFile).not.toHaveBeenCalled();
    },
  );

  it.each([
    [undefined, "DATABASE_URL_MISSING"],
    ["not a url", "PG_URL_INVALID"],
  ])("rejects unusable configuration %s", async (url, code) => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(checkPostgresReady(url)).rejects.toMatchObject({ code });
    expect(execFile).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
