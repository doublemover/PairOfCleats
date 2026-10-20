#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getCombinedOutput } from '../helpers/stdio.js';
import { runNode } from '../helpers/run-node.js';
import { applyTestEnv } from '../helpers/test-env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(ROOT, 'tools', 'ci', 'run-suite.js');
const env = applyTestEnv({ syncProcess: false });

const runDrySuite = (mode) => {
  const result = runNode(
    [runnerPath, '--mode', mode, '--dry-run'],
    `suite runner dry-run mode=${mode}`,
    ROOT,
    env,
    { stdio: 'pipe' }
  );
  return getCombinedOutput(result);
};

const assertRequired = (output, required, mode) => {
  const missing = required.filter((regex) => !regex.test(output));
  if (!missing.length) return;
  console.error(`suite runner dry-run missing expected steps for mode=${mode}`);
  for (const regex of missing) {
    console.error(`Missing: ${regex}`);
  }
  process.exit(1);
};

const ciOutput = runDrySuite('ci');
assertRequired(ciOutput, [
  /npm(?:\.cmd)? run lint/,
  /npm(?:\.cmd)? run config:budget/,
  /npm(?:\.cmd)? run env:check/,
  /tests[\\/]run\.js --lane ci-lite/,
  /--report-file/,
  /--timings-file/,
  /--stability-file/,
  /--profile/,
  /--coverage/,
  /tools[\\/]ci[\\/]capability-gate\.js --mode ci/,
  /tools[\\/]ci[\\/]tooling-doctor-gate\.js --mode ci/,
  /tools[\\/]ci[\\/]tooling-lsp-slo-gate\.js --mode ci --doctor/,
  /tools[\\/]ci[\\/]tooling-lsp-replay-gate\.js --json/,
  /tools[\\/]ci[\\/]tooling-lsp-default-enable-gate\.js/,
  /tools[\\/]ci[\\/]import-resolution-slo-gate\.js --mode ci/,
  /tools[\\/]ci[\\/]coverage-policy-report\.js --root/,
  /tools[\\/]bench[\\/]language[\\/]tooling-lsp-guardrail\.js --report/
], 'ci');

const nightlyOutput = runDrySuite('nightly');
assertRequired(nightlyOutput, [
  /tests[\\/]run\.js --lane ci /,
  /--lane storage --lane perf/,
  /--report-file/,
  /--timings-file/,
  /--stability-file/,
  /--profile/,
  /--coverage/,
  /tools[\\/]ci[\\/]coverage-policy-report\.js --root/,
  /tools[\\/]bench[\\/]bench-runner\.js --suite sweet16-ci/
], 'nightly');

for (const [mode, output] of [['ci', ciOutput], ['nightly', nightlyOutput]]) {
  const lane = output.split(/\r?\n/).filter(line => line.startsWith('[dry-run] CI test lane:'));
  assert.equal(lane.length, 1, `${mode}: expected the actual broad test command`);
  assert.match(lane[0], /--retries 0(?:\s|$)/, `${mode}: a failed first attempt must fail CI`);
  assert.match(lane[0], /--native-status-redo=false(?:\s|$)/, `${mode}: native crashes cannot be redone by CI`);
  assert.ok(output.includes('[dry-run] API contract cohort:'), `${mode}: excluded API cases have an explicit portable cohort`);
  assert.ok(output.includes('[dry-run] Serial runtime budgets:'), `${mode}: measured parser/index budgets have an explicit serial owner`);
  const xmlSelector = '/^perf\\/parsers\\/xml-cold-budget$/';
  assert.ok(lane[0].includes(xmlSelector), `${mode}: real-clock XML acceptance is excluded from concurrent correctness`);
  const serial = output.split(/\r?\n/).filter(line => line.startsWith('[dry-run] Serial runtime budgets:'));
  assert.equal(serial.length, 1);
  assert.ok(serial[0].includes(xmlSelector), `${mode}: the actual XML default APIs retain execution coverage`);
  assert.match(serial[0], /--jobs 1 --pairofcleats-threads 1 --timeout-ms 30000 --retries 0 --native-status-redo=false/);
  for (const state of ['missing', 'corrupt', 'incomplete', 'legacy']) {
    const selector = `/^smoke\\/baseline-negative\\/${state}$/`;
    assert.equal(lane[0].split(selector).length - 1, 1, `${mode}: exclude each measured diagnostic wrapper exactly once`);
    assert.equal(serial[0].split(selector).length - 1, 1, `${mode}: preserve each wrapper in the strict serial budget owner`);
  }
  const sqliteSelector = '/^storage\\/sqlite\\/build\\/cancellation$/';
  assert.ok(lane[0].includes(sqliteSelector), `${mode}: native worker startup/disposal has a serial replacement owner`);
  const native = output.split(/\r?\n/).filter(line => line.startsWith('[dry-run] Serial native lifecycle:'));
  assert.equal(native.length, 1);
  assert.ok(native[0].includes(sqliteSelector));
  assert.match(native[0], /--jobs 1 --pairofcleats-threads 1 --timeout-ms 30000 --retries 0 --native-status-redo=false/);
}

console.log('suite runner smoke and zero-retry command contracts passed');
