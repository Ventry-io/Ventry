import { execFile } from "node:child_process";

const TIMEOUT_SECONDS = 3;
// pg_isready exit codes: https://www.postgresql.org/docs/current/app-pg-isready.html
const EXIT_CODES: Record<number, string> = {
  1: "PG_ISREADY_REJECTING",
  2: "PG_ISREADY_NO_RESPONSE",
  3: "PG_ISREADY_INVALID",
};

function failure(code: string) {
  return Object.assign(new Error(`pg_isready failed: ${code}`), { code });
}

/**
 * Checks that PostgreSQL accepts connections without authenticating or running SQL.
 * Only host and port are passed, so no credentials reach the process list or logs.
 */
export function checkPostgresReady(databaseUrl = process.env.DATABASE_URL): Promise<true> {
  if (!databaseUrl) return Promise.reject(failure("DATABASE_URL_MISSING"));
  // Accelerate URLs point at an HTTP proxy, so there is no PostgreSQL socket to probe.
  if (/^prisma(\+postgres)?:\/\//.test(databaseUrl)) return Promise.reject(failure("PG_ISREADY_NOT_APPLICABLE"));

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return Promise.reject(failure("PG_URL_INVALID"));
  }
  const host = url.hostname.replace(/^\[|\]$/g, "") || url.searchParams.get("host") || "localhost";
  const port = url.port || "5432";

  return new Promise((resolve, reject) => {
    execFile(
      "pg_isready",
      ["-h", host, "-p", port, "-t", String(TIMEOUT_SECONDS)],
      { timeout: (TIMEOUT_SECONDS + 2) * 1_000 },
      (error) => {
        if (!error) return resolve(true);
        const code = error.code === "ENOENT"
          ? "PG_ISREADY_MISSING"
          : error.killed
            ? "PG_ISREADY_TIMEOUT"
            : EXIT_CODES[error.code as number] ?? "PG_ISREADY_FAILED";
        reject(failure(code));
      },
    );
  });
}
