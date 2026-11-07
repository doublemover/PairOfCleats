import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runStorageCli } from '../../../tools/storage/cli.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-cli-migration-selectors-'));
const home = path.join(root, 'home'), repo = path.join(root, 'repo');
const source = path.join(home, 'dictionaries'), destination = path.join(home, 'assets', 'dictionaries');
const originalLog = console.log, originalExitCode = process.exitCode;
const invoke = async (args, selectedHome = home) => {
  const output = []; console.log = value => output.push(value); process.exitCode = undefined;
  try {
    const receipt = await runStorageCli([...args, '--repo', repo, '--home', selectedHome, '--json']);
    assert.equal(output.length, 1); assert.deepEqual(JSON.parse(output[0]), receipt);
    return { receipt, exitCode: process.exitCode || 0 };
  } finally { console.log = originalLog; process.exitCode = originalExitCode; }
};
try {
  await fs.mkdir(repo); await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(home, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  await fs.writeFile(path.join(source, 'dictionaries.json'), '{}');
  await fs.writeFile(path.join(source, 'user.txt'), 'retained dictionary evidence\n');
  applyTestEnv({ cacheRoot: path.join(home, 'cache'), embeddings: 'off' });
  const beforePlan = await fs.readdir(root, { recursive: true });
  const planned = await invoke(['migration-plan', '--category', 'dictionaries', '--source', source, '--destination', destination]);
  assert.equal(planned.exitCode, 1, 'an unqualified permission owner never advertises an applicable CLI migration');
  assert.equal(planned.receipt.ready, false);
  assert.equal(planned.receipt.blocked.some(entry => /permission|acl/u.test(entry.reason)), true);
  assert.deepEqual(await fs.readdir(root, { recursive: true }), beforePlan, 'planning creates no destination, recovery journal or lease metadata');
  const planFile = path.join(root, 'reviewed-migration.json');
  await fs.writeFile(planFile, JSON.stringify(planned.receipt));
  const before = await fs.readdir(root, { recursive: true });
  const status = await invoke(['migration-status', '--plan', planFile]);
  assert.equal(status.exitCode, 0);
  assert.equal(status.receipt.stage, 'not-started');
  for (const action of ['migration-status', 'migration-apply', 'migration-rollback']) {
    const result = await invoke([action, '--plan', planFile, '--category', 'dictionaries',
      '--source', path.join(home, 'another-source'), '--destination', destination,
      ...(action === 'migration-status' ? [] : ['--plan-id', planned.receipt.planId])]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.receipt.mutationPerformed, false);
    assert.match(result.receipt.error.message, /reviewed --source/);
  }
  const otherHome = await invoke(['migration-status', '--plan', planFile], path.join(root, 'another-home'));
  assert.equal(otherHome.exitCode, 1);
  assert.match(otherHome.receipt.error.message, /application home differs/);
  assert.deepEqual(await fs.readdir(root, { recursive: true }), before, 'recovery selectors are checked before mutation or journal adoption');
  assert.equal(await fs.readFile(path.join(source, 'user.txt'), 'utf8'), 'retained dictionary evidence\n');
} finally { console.log = originalLog; process.exitCode = originalExitCode; await fs.rm(root, { recursive: true, force: true }); }
console.log('Storage migration CLI preserves reviewed selectors and reports unqualified planning honestly.');
