// Tests .docker/preview/preview.sh against a fake `docker` binary (no containers are started).
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const SHA = "a".repeat(40);
const SHA2 = "b".repeat(40);
const D1 = `sha256:${"1".repeat(64)}`;
const D2 = `sha256:${"2".repeat(64)}`;
const D3 = `sha256:${"3".repeat(64)}`;

const FAKE_DOCKER = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
args=" $* "
case "$args" in
  *" network inspect "*) exit "\${FAKE_NETWORK_EXIT:-0}" ;;
  *" run --rm migrate "*) exit "\${FAKE_MIGRATE_EXIT:-0}" ;;
  *" up -d --wait --wait-timeout 300 app "*) exit "\${FAKE_APP_EXIT:-0}" ;;
  *"--format {{.Label \\"com.docker.compose.project\\"}}"*) printf '%s\\n' \${FAKE_PROJECTS:-} ;;
esac
exit 0
`;

function setup({ appEnv = "OAUTH_PROXY_SECRET=x\nGOOGLE_CLIENT_ID=id\n" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ventry-preview-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "docker"), FAKE_DOCKER);
  chmodSync(join(bin, "docker"), 0o755);
  cpSync(join(repo, ".docker/preview/preview.sh"), join(root, "preview.sh"));
  cpSync(join(repo, ".docker/preview/docker-compose.preview.yml"), join(root, "docker-compose.preview.yml"));
  writeFileSync(join(root, "app.env"), appEnv);
  writeFileSync(join(root, "mailpit-ui.htpasswd"), "tester:x\n");
  writeFileSync(join(root, "preview.conf"), "PREVIEW_DOMAIN=dev.example.org\nPREVIEW_IMAGE=registry.example.org/ventry-preview/app\n");
  const log = join(root, "docker.log");
  writeFileSync(log, "");
  const run = (args, env = {}) => {
    writeFileSync(log, "");
    const result = spawnSync("bash", [join(root, "preview.sh"), ...args], {
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env.PATH}`, FAKE_LOG: log, ...env },
    });
    return { ...result, calls: readFileSync(log, "utf8").trim().split("\n").filter(Boolean) };
  };
  const ssh = (role, command, env = {}) => run(["--ssh", role], { SSH_ORIGINAL_COMMAND: command, ...env });
  return { root, run, ssh, instance: (pr) => join(root, "instances", `pr-${pr}`) };
}

test("each SSH key may only run its own commands", () => {
  const { ssh } = setup();
  for (const [role, command] of [
    ["deploy", "destroy 5"],
    ["deploy", "reconcile"],
    ["cleanup", `deploy 5 ${SHA} ${D1} ${D2} 10`],
    ["cleanup", "logs 5"],
    ["deploy", "list"],
    ["other", "destroy 5"],
    ["cleanup", ""],
  ]) {
    const result = ssh(role, command);
    assert.equal(result.status, 1, `${role}: ${command}`);
    assert.match(result.stderr, /not allowed/);
    assert.deepEqual(result.calls, []);
  }
});

test("rejects malformed arguments before touching Docker", () => {
  const { ssh } = setup();
  for (const command of [
    "destroy 5;id", "destroy $(id)", "destroy 0", "destroy 05", "destroy", "destroy 5 6", "reconcile 1 x",
  ]) {
    const result = ssh("cleanup", command);
    assert.equal(result.status, 1, command);
    assert.deepEqual(result.calls, [], command);
  }
  for (const command of [
    `deploy 5 ${SHA.slice(1)} ${D1} ${D2} 10`,
    `deploy 5 ${SHA} sha256:abc ${D2} 10`,
    `deploy 5 ${SHA} ${D1} ${D2} 0`,
    `deploy 5 ${SHA} ${D1} ${D2}`,
    `deploy 5 ${SHA} ${D1}@evil ${D2} 10`,
  ]) {
    const result = ssh("deploy", command);
    assert.equal(result.status, 1, command);
    assert.deepEqual(result.calls, [], command);
  }
});

test("deploys by digest, migrates before starting the app, and keeps secrets across updates", () => {
  const { ssh, instance } = setup();
  const first = ssh("deploy", `deploy 7 ${SHA} ${D1} ${D2} 100`);
  assert.equal(first.status, 0, first.stderr);
  assert.ok(first.calls.includes(`pull -q registry.example.org/ventry-preview/app@${D1}`));
  const migrateAt = first.calls.findIndex((call) => call.includes("run --rm migrate"));
  const appAt = first.calls.findIndex((call) => call.endsWith("up -d --wait --wait-timeout 300 app"));
  assert.ok(migrateAt > 0 && appAt > migrateAt);
  assert.ok(first.calls.every((call) => !call.startsWith("compose") || call.includes("-p ventry-pr-7 ")));

  const env = readFileSync(join(instance(7), ".env"), "utf8");
  assert.match(env, /^PREVIEW_URL=https:\/\/pr-7\.dev\.example\.org$/m);
  assert.match(env, /^PREVIEW_PROJECT=ventry-pr-7$/m);
  assert.match(env, /^JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n/m);
  const secret = env.match(/^BETTER_AUTH_SECRET=([0-9a-f]{64})$/m)[1];
  assert.match(readFileSync(join(instance(7), "state"), "utf8"), new RegExp(`^sha=${SHA}$`, "m"));

  const second = ssh("deploy", `deploy 7 ${SHA2} ${D3} ${D2} 101`);
  assert.equal(second.status, 0, second.stderr);
  const env2 = readFileSync(join(instance(7), ".env"), "utf8");
  assert.equal(env2.match(/^BETTER_AUTH_SECRET=(.*)$/m)[1], secret);
  assert.match(env2, new RegExp(`^APP_IMAGE=registry\\.example\\.org/ventry-preview/app@${D3}$`, "m"));
  assert.ok(second.calls.includes(`image rm registry.example.org/ventry-preview/app@${D1}`));
});

test("an older run never replaces a newer deployment", () => {
  const { ssh, instance } = setup();
  assert.equal(ssh("deploy", `deploy 7 ${SHA2} ${D3} ${D2} 200`).status, 0);
  const stale = ssh("deploy", `deploy 7 ${SHA} ${D1} ${D2} 150`);
  assert.equal(stale.status, 3);
  assert.ok(!stale.calls.some((call) => call.startsWith("pull")));
  assert.match(readFileSync(join(instance(7), "state"), "utf8"), new RegExp(`^sha=${SHA2}$`, "m"));
  // A re-run of the live generation is allowed.
  assert.equal(ssh("deploy", `deploy 7 ${SHA2} ${D3} ${D2} 200`).status, 0);
});

test("restarts the previous image when the new one is unhealthy", () => {
  const { ssh, instance } = setup();
  assert.equal(ssh("deploy", `deploy 7 ${SHA} ${D1} ${D2} 100`).status, 0);
  const failed = ssh("deploy", `deploy 7 ${SHA2} ${D3} ${D2} 101`, { FAKE_APP_EXIT: "1" });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /previous image/);
  assert.match(readFileSync(join(instance(7), ".env"), "utf8"), new RegExp(`^APP_IMAGE=.*@${D1}$`, "m"));
  assert.match(readFileSync(join(instance(7), "state"), "utf8"), new RegExp(`^sha=${SHA}$`, "m"));
});

test("leaves the running app alone when migrations fail", () => {
  const { ssh } = setup();
  const result = ssh("deploy", `deploy 7 ${SHA} ${D1} ${D2} 100`, { FAKE_MIGRATE_EXIT: "1" });
  assert.equal(result.status, 1);
  assert.ok(!result.calls.some((call) => call.endsWith(" app")));
});

test("refuses live Stripe keys and OAuth client secrets in app.env", () => {
  for (const appEnv of ["STRIPE_SECRET_KEY=sk_live_123\n", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=\"pk_live_1\"\n", "GITHUB_CLIENT_SECRET=abc\n"]) {
    const { ssh } = setup({ appEnv });
    const result = ssh("deploy", `deploy 7 ${SHA} ${D1} ${D2} 100`);
    assert.equal(result.status, 1, appEnv);
    assert.ok(!result.calls.some((call) => call.startsWith("pull")), appEnv);
  }
  const { ssh } = setup({ appEnv: "STRIPE_SECRET_KEY=sk_test_1\nGITHUB_CLIENT_SECRET=\n" });
  assert.equal(ssh("deploy", `deploy 7 ${SHA} ${D1} ${D2} 100`).status, 0);
});

test("destroy is idempotent and scoped to the exact project", () => {
  const { ssh, instance } = setup();
  assert.equal(ssh("deploy", `deploy 7 ${SHA} ${D1} ${D2} 100`).status, 0);
  const destroyed = ssh("cleanup", "destroy 7");
  assert.equal(destroyed.status, 0, destroyed.stderr);
  assert.ok(!existsSync(instance(7)));
  assert.ok(destroyed.calls.some((call) => call.includes("down --volumes --remove-orphans")));
  for (const call of destroyed.calls.filter((c) => c.includes("--filter"))) {
    assert.match(call, /label=com\.docker\.compose\.project=ventry-pr-7( |$)/);
  }
  assert.equal(ssh("cleanup", "destroy 7").status, 0);
});

test("reconcile removes only previews whose PR is closed", () => {
  const { ssh, instance } = setup();
  assert.equal(ssh("deploy", `deploy 7 ${SHA} ${D1} ${D2} 100`).status, 0);
  assert.equal(ssh("deploy", `deploy 8 ${SHA} ${D1} ${D2} 100`).status, 0);
  const result = ssh("cleanup", "reconcile 8 9", { FAKE_PROJECTS: "ventry-pr-7 ventry-pr-12 ventry-main venuva-dev ventry-pr-x" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!existsSync(instance(7)));
  assert.ok(existsSync(instance(8)));
  const destroyedProjects = result.calls.filter((c) => c.startsWith("ps -aq")).map((c) => c.match(/ventry-pr-\d+/)[0]);
  assert.deepEqual(destroyedProjects.sort(), ["ventry-pr-12", "ventry-pr-7"]);
});
