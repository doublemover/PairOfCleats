import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'yaml';
import { readPlatformWorkflow, platformToolingSteps } from '../helpers/ci-platform-workflow.js';
import { extraPlatformSteps } from '../../tools/ci/suite-cohorts.js';

const main = parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
const workflow = readPlatformWorkflow(), { prepare, correctness, serial, tooling, aggregate } = workflow.jobs;
const deps = parse(fs.readFileSync('.github/actions/ci-dependencies/action.yml', 'utf8'));
for (const platform of ['ubuntu', 'windows', 'macos']) {
  const called = main.jobs[platform + '-cohorts'];
  assert.equal(called.uses, './.github/workflows/ci-platform.yml');
  assert.deepEqual(called.with, { platform, runner: `${platform}-latest` });
  assert.equal(called.needs, 'gate');
  const final = main.jobs[platform];
  assert.equal(final.name, platform); assert.equal(final.if, 'always()');
  assert.deepEqual(final.needs, ['gate', platform + '-cohorts']);
  assert.ok(final.steps[0].run.includes('needs.gate.result') && final.steps[0].run.includes(`needs.${platform}-cohorts.result`));
  assert.equal(final.steps[0].run.split("-ne 'success'").length, 3);
  const selected = platformToolingSteps(platform);
  assert.equal(selected.filter(step => step.name === 'Setup qualified Go SDK').length, 1);
  assert.equal(selected.filter(step => step.name === 'Setup qualified .NET SDK').length, 1);
  assert.equal(selected.filter(step => step.name === 'Setup qualified PHP runtime').length, platform === 'windows' ? 0 : 1);
}
assert.deepEqual(correctness.strategy.matrix.shard, [1, 2, 3, 4]);
assert.equal(correctness.strategy['fail-fast'], false); assert.equal(serial.strategy['fail-fast'], false);
assert.equal(serial.strategy.matrix.cohort, '${{ fromJSON(needs.prepare.outputs.serial-cohorts) }}');
assert.ok(prepare.outputs['serial-cohorts'].includes('steps.plan.outputs.serial-cohorts'));
assert.equal(prepare.steps.find(step => step.id === 'plan').run, 'node tools/ci/prepare-platform-cohorts.js');
assert.equal(aggregate.if, 'always()'); assert.deepEqual(aggregate.needs, ['prepare', 'correctness', 'serial', 'tooling']);
for (const [name, job] of Object.entries(workflow.jobs)) {
  assert.equal(job['runs-on'], '${{ inputs.runner }}');
  assert.ok(job.steps.some(step => step.uses === './.github/actions/ci-dependencies'));
  assert.equal(job.steps.find(step => step.uses === 'actions/checkout@v7').with.ref, '${{ github.sha }}');
  assert.ok(job['timeout-minutes'] > 0);
  if (['correctness', 'serial', 'tooling'].includes(name)) {
    assert.ok(job.steps.find(step => step.name === 'Download OS cohort plan'));
    const upload = job.steps.find(step => step.name === 'Upload original cohort evidence');
    assert.equal(upload.if, 'always()'); assert.equal(upload.with['if-no-files-found'], 'error');
    assert.equal(upload.with['include-hidden-files'], true);
    assert.ok(upload.with.path.includes('.diagnostics/**') && upload.with.path.includes('.testLogs/**'));
  }
  if (name !== 'tooling') assert.equal(job.steps.some(step => /setup-(go|dotnet)|ci-tooling/.test(step.uses || '')), false,
    'serial and correctness runners must not provision unrelated provider SDKs');
}
const merge = aggregate.steps.find(step => step.id === 'aggregate');
assert.equal(merge.run, 'node tools/ci/aggregate-platform-cohorts.js ${{ inputs.platform }}');
assert.equal(aggregate.steps.find(step => step.name === 'Upload quality artifacts').with.name, 'ci-quality-artifacts-${{ inputs.platform }}');
assert.ok(aggregate.steps.find(step => step.name === 'Coverage policy report').if.includes('correctness-complete'));
const node = deps.runs.steps.find(step => step.uses === 'actions/setup-node@v7');
assert.equal(node.with['node-version'], fs.readFileSync('.nvmrc', 'utf8').trim());
const restore = deps.runs.steps.find(step => step.uses === 'actions/cache/restore@v6');
assert.ok(restore.with.path.includes('node_modules') && restore.with.path.includes('.cache/native-build/headers'));
assert.ok(deps.runs.steps.find(step => step.run)?.run.includes('rebuild-native.js --verify'));
assert.ok(deps.runs.steps.find(step => step.run)?.run.includes('npm run bootstrap:ci'));
const save = deps.runs.steps.find(step => step.uses === 'actions/cache/save@v6');
assert.ok(save.if.includes("inputs.save-cache == 'true'"));
assert.deepEqual(save.with, restore.with);
assert.ok(prepare.steps.find(step => step.uses === './.github/actions/ci-dependencies').with['save-cache'] === 'true');
for (const step of extraPlatformSteps('win32')) for (const flag of ['--jobs', '--pairofcleats-threads', '--timeout-ms', '--retries'])
  assert.equal(step.args[step.args.indexOf(flag) + 1], { '--jobs': '1', '--pairofcleats-threads': '1', '--timeout-ms': '30000', '--retries': '0' }[flag]);
console.log('Each OS owns four exact shards, isolated serial cohorts, scoped SDKs and required aggregate evidence.');
