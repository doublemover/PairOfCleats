import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'yaml';

const workflow = parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
const job = workflow.jobs['native-inspection'];
assert.deepEqual(job.strategy.matrix.os, ['ubuntu-latest', 'windows-latest', 'macos-latest']);
assert.equal(job.needs, 'gate');
assert.equal(job['timeout-minutes'], 20);
const steps = job.steps, commands = steps.map(step => step.run || '');
assert.equal(steps.find(step => step.uses?.startsWith('actions/checkout@')).with.ref,
  '${{ github.event.pull_request.head.sha || github.sha }}');
assert.equal(steps.find(step => step.uses?.startsWith('actions/setup-node@')).with['node-version-file'], '.nvmrc');
for (const command of ['git rev-parse HEAD', 'npm run bootstrap:ci',
  'node tools/setup/rebuild-native.js --verify', 'cargo build --locked --manifest-path crates/pairofcleats-tui/Cargo.toml']) {
  assert.ok(commands.includes(command), `missing actual prerequisite: ${command}`);
}
const run = commands.find(command => command.includes('node tests/run.js'));
assert.ok(run.includes('native-job-inspection|native-artifact-actions'));
for (const option of ['--jobs 1', '--pairofcleats-threads 1', '--timeout-ms 30000', '--retries 0', '--native-status-redo=false']) {
  assert.ok(run.includes(option), `native qualification must retain ${option}`);
}
const upload = steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
assert.equal(upload.if, 'always()'); assert.equal(upload.with['include-hidden-files'], true);
assert.ok(upload.with.path.includes('.testLogs/**'));
console.log('Native inspection qualification uses actual source, setup, binary and serial terminal owners on all three platforms');
