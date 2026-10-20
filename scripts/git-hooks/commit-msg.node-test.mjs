import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const hook = fileURLToPath(new URL("./commit-msg", import.meta.url));

test("validates prefixes and blocks invalid commits through Git", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ventry-commit-hook-"));
  const messagePath = join(cwd, "message.txt");
  try {
    for (const message of [
      ...["feat", "fix", "chore", "docs", "style", "refactor", "perf", "test", "build", "ci", "revert"].map(type => `${type}: change`),
      "feat(crew): add departments", "fix(api)!: change response",
      "feat!: change API\r\n\r\nBREAKING CHANGE: new response",
      "Merge pull request #12 from Ventry-io/dev", "Merge branch 'dev'",
      "Revert \"feat: add departments\"", "fix: repair Unicode names Äö",
    ]) {
      writeFileSync(messagePath, message);
      assert.equal(spawnSync(hook, [messagePath]).status, 0, message);
      assert.equal(readFileSync(messagePath, "utf8"), message);
    }
    for (const message of ["", "t", "chores: update", "Fix: repair", "feat(): change", "feat: ", "feat:no space", "feat\nfix: hidden prefix"]) {
      writeFileSync(messagePath, message);
      assert.equal(spawnSync(hook, [messagePath]).status, 1, message);
    }
    assert.equal(spawnSync(hook, [join(cwd, "missing.txt")]).status, 1);

    const git = args => spawnSync("git", args, {
      cwd, encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    for (const args of [
      ["init", "-b", "main"], ["config", "user.name", "Hook Test"],
      ["config", "user.email", "hook@example.com"], ["config", "commit.gpgsign", "false"],
      ["config", "core.hooksPath", dirname(hook)],
      ["commit", "--allow-empty", "-m", "chore: initial"],
    ]) {
      const result = git(args);
      assert.equal(result.status, 0, result.stderr);
    }
    const before = git(["rev-parse", "HEAD"]).stdout;
    const rejected = git(["commit", "--allow-empty", "-m", "invalid message"]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stdout + rejected.stderr, /Invalid commit subject/);
    assert.equal(git(["rev-parse", "HEAD"]).stdout, before);
    assert.equal(git(["commit", "--allow-empty", "-m", "feat(crew)!: change roles"]).status, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
