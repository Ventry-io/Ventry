#!/usr/bin/env node
// Deletes PR preview images from Harbor. Tags look like pr-<n>-<sha12> and pr-<n>-<sha12>-migrate.
//
//   harbor-preview-prune.mjs <project/repository> --pr <n> [--keep <count>]   keep the newest <count> commits of PR n (0 = all gone)
//   harbor-preview-prune.mjs <project/repository> --open <n,n,...>           delete images of every PR not listed
//
// Env: HARBOR_REGISTRY (host), HARBOR_USER, HARBOR_PASSWORD (a robot limited to the preview project).
import { pathToFileURL } from "node:url";

const TAG = /^pr-([1-9]\d*)-([0-9a-f]{12})(?:-migrate)?$/;

/** Returns digests to delete. Artifacts without a preview tag are never touched. */
export function selectDeletions(artifacts, { pr, keep = 0, openPrs }) {
  const commits = new Map(); // `${pr}-${sha}` -> { pr, newest, digests }
  for (const artifact of artifacts) {
    const match = (artifact.tags ?? []).map((tag) => TAG.exec(tag.name)).find(Boolean);
    if (!match) continue;
    const key = `${match[1]}-${match[2]}`;
    const entry = commits.get(key) ?? { pr: Number(match[1]), newest: 0, digests: [] };
    entry.newest = Math.max(entry.newest, Date.parse(artifact.push_time) || 0);
    entry.digests.push(artifact.digest);
    commits.set(key, entry);
  }

  const entries = [...commits.values()];
  if (openPrs) return entries.filter((entry) => !openPrs.has(entry.pr)).flatMap((entry) => entry.digests);
  return entries
    .filter((entry) => entry.pr === pr)
    .sort((a, b) => b.newest - a.newest)
    .slice(keep)
    .flatMap((entry) => entry.digests);
}

export function parseArgs(argv) {
  const [repository, flag, value, keepFlag, keepValue] = argv;
  if (!/^[a-z0-9._-]+\/[a-z0-9._/-]+$/.test(repository ?? "")) throw new Error("invalid repository");
  if (flag === "--pr" && /^[1-9]\d*$/.test(value ?? "")) {
    const keep = keepFlag === undefined ? 0 : keepFlag === "--keep" && /^\d+$/.test(keepValue ?? "") ? Number(keepValue) : NaN;
    if (Number.isNaN(keep)) throw new Error("invalid --keep");
    return { repository, pr: Number(value), keep };
  }
  if (flag === "--open" && /^(\d+(,\d+)*)?$/.test(value ?? "")) {
    return { repository, openPrs: new Set(value ? value.split(",").map(Number) : []) };
  }
  throw new Error("usage: harbor-preview-prune.mjs <project/repository> --pr <n> [--keep <count>] | --open <n,n,...>");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { HARBOR_REGISTRY: registry, HARBOR_USER: user, HARBOR_PASSWORD: password } = process.env;
  if (!registry || !user || !password) throw new Error("HARBOR_REGISTRY, HARBOR_USER and HARBOR_PASSWORD are required");

  const [project, ...rest] = options.repository.split("/");
  // Harbor expects repository names with slashes to be URL-encoded twice.
  const base = `https://${registry}/api/v2.0/projects/${project}/repositories/${encodeURIComponent(encodeURIComponent(rest.join("/")))}/artifacts`;
  const headers = { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`, accept: "application/json" };

  const artifacts = [];
  for (let page = 1; ; page++) {
    const response = await fetch(`${base}?with_tag=true&page_size=100&page=${page}`, { headers });
    if (response.status === 404) break; // repository does not exist yet
    if (!response.ok) throw new Error(`listing artifacts failed: HTTP ${response.status}`);
    const batch = await response.json();
    artifacts.push(...batch);
    if (batch.length < 100) break;
  }

  const digests = selectDeletions(artifacts, options);
  for (const digest of digests) {
    const response = await fetch(`${base}/${digest}`, { method: "DELETE", headers });
    if (!response.ok && response.status !== 404) throw new Error(`deleting ${digest} failed: HTTP ${response.status}`);
    console.log(`deleted ${options.repository}@${digest}`);
  }
  console.log(`pruned ${digests.length} preview image(s)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
