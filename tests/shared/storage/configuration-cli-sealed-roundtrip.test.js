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
  const invokeAt = (selectedHome, args) => runNode(['tools/storage/cli.js', ...args, '--repo', repo, '--home', selectedHome, '--json'],
    'storage sealed CLI plan', process.cwd(), env, { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  const invoke = args => invokeAt(home, args);
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
  for (const change of ['source-ancestor', 'destination-ancestor']) {
    const selectedHome = path.join(temporary, `${change}-home`);
    const parent = path.join(temporary, `${change}-parent`), target = path.join(parent, 'models');
    const preview = invokeAt(selectedHome, ['configure-plan', '--category', 'models', '--path', target]);
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    const plan = JSON.parse(preview.stdout), file = path.join(temporary, `${change}-plan.json`);
    await fs.writeFile(file, JSON.stringify(plan));
    await fs.mkdir(change === 'source-ancestor' ? selectedHome : parent);
    const refused = invokeAt(selectedHome, ['configure-apply', '--category', 'models', '--path', target,
      '--plan', file, '--plan-id', plan.planId]);
    assert.notEqual(refused.status, 0, 'unrelated ancestor creation cannot inherit lock-preparation authority');
    await assert.rejects(fs.lstat(target), { code: 'ENOENT' });
    assert.equal(readStorageLocator(selectedHome).value.categories.models, undefined);
  }
} finally { await rmDirRecursive(temporary); }
console.log('configuration CLI sealed review roundtrip passed');
