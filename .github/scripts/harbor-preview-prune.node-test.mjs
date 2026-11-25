import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, selectDeletions } from "./harbor-preview-prune.mjs";

const artifact = (digest, tag, pushed) => ({ digest, push_time: pushed, tags: tag ? [{ name: tag }] : null });
const artifacts = [
  artifact("sha256:a1", "pr-12-aaaaaaaaaaaa", "2026-11-01T10:00:00Z"),
  artifact("sha256:a2", "pr-12-aaaaaaaaaaaa-migrate", "2026-11-01T10:00:01Z"),
  artifact("sha256:b1", "pr-12-bbbbbbbbbbbb", "2026-11-02T10:00:00Z"),
  artifact("sha256:b2", "pr-12-bbbbbbbbbbbb-migrate", "2026-11-02T10:00:01Z"),
  artifact("sha256:c1", "pr-12-cccccccccccc", "2026-11-03T10:00:00Z"),
  artifact("sha256:c2", "pr-12-cccccccccccc-migrate", "2026-11-03T10:00:01Z"),
  artifact("sha256:d1", "pr-120-dddddddddddd", "2026-11-03T10:00:00Z"),
  artifact("sha256:e1", "dev-venuva", "2026-11-03T10:00:00Z"),
  artifact("sha256:f1", null, "2026-10-03T10:00:00Z"),
];

test("keeps the newest commits of one PR and both of their images", () => {
  assert.deepEqual(selectDeletions(artifacts, { pr: 12, keep: 2 }).sort(), ["sha256:a1", "sha256:a2"]);
});

test("keep 0 removes every image of that PR only", () => {
  assert.deepEqual(selectDeletions(artifacts, { pr: 12, keep: 0 }).sort(), ["sha256:a1", "sha256:a2", "sha256:b1", "sha256:b2", "sha256:c1", "sha256:c2"]);
});

test("reconcile removes closed PRs and never touches untagged or non-preview artifacts", () => {
  assert.deepEqual(selectDeletions(artifacts, { openPrs: new Set([12]) }), ["sha256:d1"]);
  assert.deepEqual(selectDeletions(artifacts, { openPrs: new Set([12, 120]) }), []);
});

test("parses arguments strictly", () => {
  assert.deepEqual(parseArgs(["ventry-preview/app", "--pr", "12", "--keep", "2"]), { repository: "ventry-preview/app", pr: 12, keep: 2 });
  assert.deepEqual(parseArgs(["ventry-preview/app", "--pr", "12"]), { repository: "ventry-preview/app", pr: 12, keep: 0 });
  assert.deepEqual(parseArgs(["ventry-preview/app", "--open", ""]).openPrs, new Set());
  assert.deepEqual(parseArgs(["ventry-preview/app", "--open", "3,4"]).openPrs, new Set([3, 4]));
  for (const bad of [["x", "--pr", "1"], ["a/b", "--pr", "0"], ["a/b", "--pr", "1;rm"], ["a/b", "--open", "1,,2"], ["a/b", "--pr", "1", "--keep", "-1"]]) {
    assert.throws(() => parseArgs(bad));
  }
});
