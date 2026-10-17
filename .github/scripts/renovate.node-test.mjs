import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const config = JSON.parse(readFileSync(new URL("../../renovate.json", import.meta.url), "utf8"));

test("npm major fallbacks precede family overrides and remain scoped to their dependency types", () => {
  const families = config.packageRules
    .map((rule, index) => ({ ...rule, index }))
    .filter((rule) => rule.groupName && rule.matchPackageNames && rule.matchManagers?.includes("npm"));
  assert.ok(families.length > 0);
  for (const [depType, groupName] of [
    ["dependencies", "npm Runtime Major Updates"],
    ["devDependencies", "npm Development Major Updates"],
  ]) {
    const index = config.packageRules.findIndex((rule) => rule.groupName === groupName);
    assert.ok(index >= 0, groupName);
    const rule = config.packageRules[index];
    assert.deepEqual(rule.matchManagers, ["npm"]);
    assert.deepEqual(rule.matchDepTypes, [depType]);
    assert.deepEqual(rule.matchUpdateTypes, ["major"]);
    assert.ok(families.every((family) => family.index > index), `${groupName}: families must win`);
  }
});

test("PR creation retains the release-age gate and manual merges", () => {
  assert.equal(config.internalChecksFilter, "strict");
  assert.equal(config.prCreation, "immediate");
  assert.equal(config.automerge, false);
  assert.equal(config.vulnerabilityAlerts.automerge, false);
  assert.equal(config.vulnerabilityAlerts.minimumReleaseAge, null);
});

for (const workflow of ["dev-pr-issue-link", "dev-pr-to-testing"]) {
  const source = readFileSync(new URL(`../workflows/${workflow}.yml`, import.meta.url), "utf8");
  const condition = source.match(/^    if: (.+)$/m)?.[1];
  assert.ok(condition, `${workflow}: expected a job condition before any privileged steps`);

  for (const [author, merged, expected] of [
    ["renovate[bot]", false, false],
    ["renovate[bot]", true, false],
    ["developer", true, true],
    ["developer", false, workflow === "dev-pr-issue-link"],
    ["other[bot]", true, true],
  ]) {
    test(`${workflow}: author=${author}, merged=${merged}`, () => {
      const github = {
        actor: "maintainer-rerunning-the-workflow",
        event: { pull_request: { user: { login: author }, merged } },
      };
      assert.equal(runInNewContext(condition, { github }), expected);
    });
  }
}
