import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';

const root = await makeTempDir('poc-ci-temporary-root-');
const environmentFile = path.join(root, 'environment'), outside = await makeTempDir('poc-ci-temporary-outside-');
const action = parse(await fs.readFile('.github/actions/ci-temporary-root/action.yml', 'utf8'));
assert.equal(action.runs.steps[0].if, "runner.os == 'Windows'");
const script = action.runs.steps[0].run.match(/node --input-type=module -e '([\s\S]+)'/)[1];
await fs.writeFile(environmentFile, 'EXISTING=preserved\n');
try {
  const launch = file => spawnSubprocess(process.execPath, ['--input-type=module', '-e', script], {
    cwd: outside, env: { ...process.env, RUNNER_TEMP: root, GITHUB_ENV: file, GITHUB_SHA: 'a'.repeat(40) },
    stdio: 'pipe', timeoutMs: 10000, maxOutputBytes: 16384, rejectOnNonZeroExit: false
  });
  const first = await launch(environmentFile), second = await launch(environmentFile);
  assert.equal(first.exitCode, 0, first.stderr);
  assert.equal(second.exitCode, 0, second.stderr);
  assert.equal(first.stderr + second.stderr, '');
  const selected = [first, second].map(result => JSON.parse(result.stdout).selected);
  assert.notEqual(...selected, 'each launch receives an independently owned temporary root');
  for (const directory of selected) {
    assert.equal(path.dirname(directory), root);
    assert.equal(await fs.realpath(directory), directory);
    assert.equal((await fs.stat(directory)).isDirectory(), true);
  }
  assert.equal(await fs.readFile(environmentFile, 'utf8'), 'EXISTING=preserved\n'
    + selected.map(directory => `TEMP=${directory}\nTMP=${directory}\n`).join(''));
  const report = JSON.parse(await fs.readFile(path.join(outside, '.diagnostics/temporary-root.json'), 'utf8'));
  assert.equal(report.source, 'a'.repeat(40));
  assert.equal(report.operationBoundsChanged, false);
  assert.equal(report.selected, selected[1]);
  const rejected = path.join(outside, 'unrelated-environment');
  await fs.writeFile(rejected, 'preserved');
  const before = await fs.readdir(root);
  assert.notEqual((await launch(rejected)).exitCode, 0, 'a foreign environment-file namespace cannot receive mutation');
  assert.deepEqual(await fs.readdir(root), before, 'rejected inputs create no temporary roots');
  assert.equal(await fs.readFile(rejected, 'utf8'), 'preserved');
  const dependencies = parse(await fs.readFile('.github/actions/ci-dependencies/action.yml', 'utf8'));
  const steps = dependencies.runs.steps;
  const admission = steps.findIndex(step => step.uses === './.github/actions/ci-temporary-root');
  assert.ok(admission > steps.findIndex(step => step.name === 'Setup Node'));
  assert.ok(admission < steps.findIndex(step => step.name === 'Locked bootstrap or fresh verification'));
  const workflow = parse(await fs.readFile('.github/workflows/ci.yml', 'utf8'));
  assert.ok(workflow.jobs['windows-authority'].steps.some(step => step.uses === './.github/actions/ci-temporary-root'));
} finally {
  await rmDirRecursive(root, { retries: 0 });
  await rmDirRecursive(outside, { retries: 0 });
}
console.log('Windows CI temporary roots are physical, job-owned, isolated and bounded by the original runner namespace.');
