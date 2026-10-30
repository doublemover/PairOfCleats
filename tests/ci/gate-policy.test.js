import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'yaml';

const policy = fs.readFileSync('docs/guides/ci-gate-policy.md', 'utf8');
const match = /<!-- required-check-inventory -->\s*```json\s*([^`]+)```/.exec(policy);
assert.ok(match, 'merge/release scopes need an explicit check inventory');
const inventory = JSON.parse(match[1]);
const workflow = filename => parse(fs.readFileSync(`.github/workflows/${filename}`, 'utf8'));
assert.deepEqual(new Set(inventory.mergeJobs), new Set(Object.keys(workflow(inventory.mergeWorkflow).jobs)));
assert.deepEqual(new Set(inventory.conditionalMergeJobs), new Set(Object.keys(workflow(inventory.conditionalMergeWorkflow).jobs)));
const long = workflow('ci-long.yml');
assert.deepEqual(Object.keys(long.on).sort(), ['push', 'workflow_dispatch']);
assert.deepEqual(long.on.push, { tags: ['v*'] }, 'CI Long has release-tag, not ordinary branch/PR scope');
assert.deepEqual(inventory.releaseWorkflows, [workflow('ci.yml').name, long.name]);
assert.match(policy, /CI Long qualifies releases/);
assert.match(policy, /not a required PR check/);
const release = fs.readFileSync('.github/workflows/release.yml', 'utf8');
for (const filename of [inventory.mergeWorkflow, 'ci-long.yml']) {
  assert.ok(release.includes(`wait_for_successful_run '${filename}' 'dispatch'`));
}
console.log('Merge policy inventories actual jobs separately from exact-SHA release CI Long evidence and makes enforcement limits explicit.');
