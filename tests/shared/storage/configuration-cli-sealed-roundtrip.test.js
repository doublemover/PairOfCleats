import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { storagePlanDigest } from '../../../src/shared/storage/migration-plan.js';
import { readStorageLocator } from '../../../src/shared/storage/locator-read.js';

const temporary = await makeTempDir('poc-storage-cli-sealed-plan-');
try {
  const repo = path.join(temporary, 'repo');
  const home = path.join(temporary, 'home');
  const destination = path.join(temporary, 'empty-model-target');
  await fs.mkdir(repo);
  const env = applyTestEnv({ syncProcess: false });
  const invoke = args => runNode(['tools/storage/cli.js', ...args, '--repo', repo, '--home', home, '--json'],
    'storage sealed CLI plan', process.cwd(), env, { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  const preview = invoke(['configure-plan', '--category', 'models', '--path', destination]);
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  const plan = JSON.parse(preview.stdout);
  const { planId, dryRun, ...body } = plan;
  assert.equal(dryRun, true);
  assert.equal(planId, storagePlanDigest(body), 'actual emitted CLI bytes remain exact reviewed authority');
  assert.equal(Object.hasOwn(plan, 'configurationErrors'), false, 'unsealed diagnostic fields must not be appended to plans');
  const file = path.join(temporary, 'reviewed-plan.json');
  await fs.writeFile(file, JSON.stringify(plan));
  const apply = invoke(['configure-apply', '--category', 'models', '--path', destination, '--plan', file, '--plan-id', planId]);
  assert.equal(apply.status, 0, apply.stderr || apply.stdout);
  assert.equal(JSON.parse(apply.stdout).complete, true);
  assert.equal(readStorageLocator(home).value.categories.models.path, destination);
  await assert.rejects(fs.lstat(destination), { code: 'ENOENT' });
  const stale = invoke(['configure-apply', '--category', 'models', '--path', destination, '--plan', file, '--plan-id', planId]);
  assert.notEqual(stale.status, 0, 'successful roundtrip does not weaken stale-plan rejection');
} finally { await rmDirRecursive(temporary); }
console.log('configuration CLI sealed review roundtrip passed');
