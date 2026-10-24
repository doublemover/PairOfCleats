import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { readStorageProbePolicy } from '../../../src/shared/storage/probe-policy-read.js';

const temporary = await makeTempDir('poc-probe-policy-cli-');
try {
  const home = path.join(temporary, 'home');
  const repo = path.join(temporary, 'repo');
  await fs.mkdir(repo);
  const env = applyTestEnv({ syncProcess: false });
  const invoke = args => runNode(['tools/storage/cli.js', ...args, '--repo', repo, '--home', home,
    '--category', 'command-probes', '--json'], 'storage probe policy CLI', process.cwd(), env,
  { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  const planResult = invoke(['policy-plan', '--enabled', 'false', '--entry-limit', '0']);
  assert.equal(planResult.status, 0, planResult.stderr || planResult.stdout);
  const plan = JSON.parse(planResult.stdout);
  assert.equal(plan.after.enabled, false);
  assert.equal(plan.after.entryLimit, 0);
  assert.equal(readStorageProbePolicy(home).status, 'missing');
  const file = path.join(temporary, 'reviewed.json');
  await fs.writeFile(file, JSON.stringify(plan));
  const applied = invoke(['policy-apply', '--plan', file, '--plan-id', plan.planId]);
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  assert.equal(JSON.parse(applied.stdout).cacheMutationPerformed, false);
  const preserve = invoke(['policy-plan', '--hard-bytes', '1024']);
  assert.equal(preserve.status, 0, preserve.stderr || preserve.stdout);
  const next = JSON.parse(preserve.stdout);
  assert.equal(next.after.enabled, false, 'omitted boolean preserves previous false');
  assert.equal(next.after.entryLimit, 0);
  assert.equal(next.after.hardBytes, 1024);
  assert.notEqual(invoke(['policy-plan', '--entry-limit', '-1']).status, 0);
  assert.notEqual(invoke(['policy-plan', '--future-policy', 'true']).status, 0);
  await fs.writeFile(path.join(home, 'config', 'storage-policies.json'), '{invalid-policy');
  const doctor = invoke(['doctor']);
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  assert.equal(JSON.parse(doctor.stdout).findings.some(item => item.code === 'invalid-machine-storage-policy'), true);
} finally { await rmDirRecursive(temporary); }
console.log('probe policy CLI exact review passed');
