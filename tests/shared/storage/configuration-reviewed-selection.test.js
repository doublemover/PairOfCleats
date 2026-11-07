import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planStorageConfiguration, applyStorageConfiguration } from '../../../src/shared/storage/configuration.js';
import { readStorageLocator } from '../../../src/shared/storage/locator-read.js';

const temporary = await makeTempDir('poc-storage-configuration-');
try {
  const home = path.join(temporary, 'home');
  const source = path.join(home, 'models');
  const destination = path.join(temporary, 'destination 雪');
  await fs.mkdir(source, { recursive: true });
  const layout = resolveStorageLayout({ home, env: {} });
  const plan = await planStorageConfiguration({ layout, category: 'models', currentPath: source, target: destination });
  assert.equal(plan.ready, true);
  assert.equal(plan.dryRun, true);
  assert.equal(readStorageLocator(home).status, 'missing');
  await assert.rejects(() => applyStorageConfiguration(plan, { approvedPlanId: plan.planId,
    home: path.join(temporary, 'wrong-home'), category: 'models', target: destination }), /explicit launch-selected/);
  await fs.writeFile(path.join(source, 'saved-model'), 'retained original');
  await assert.rejects(() => applyStorageConfiguration(plan, { approvedPlanId: plan.planId,
    home, category: 'models', target: destination }), /changed after preview/);
  assert.equal(await fs.readFile(path.join(source, 'saved-model'), 'utf8'), 'retained original');
  const blocked = await planStorageConfiguration({ layout, category: 'models', currentPath: source, target: destination });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.blocked.includes('existing-source-requires-verified-category-migration'), true);
  // A different empty fixture source establishes the positive selection case;
  // the retained nonempty original above is never made eligible by rewriting it.
  const empty = path.join(home, 'empty-models');
  await fs.mkdir(empty);
  const fresh = await planStorageConfiguration({ layout, category: 'models', currentPath: empty, target: destination });
  const applied = await applyStorageConfiguration(fresh, { approvedPlanId: fresh.planId,
    home, category: 'models', target: destination });
  assert.equal(applied.complete, true);
  assert.equal(applied.destinationCreated, false);
  await assert.rejects(fs.lstat(destination), { code: 'ENOENT' });
  assert.equal(readStorageLocator(home).value.categories.models.path, destination);
  assert.equal(await fs.readFile(path.join(source, 'saved-model'), 'utf8'), 'retained original');
  await assert.rejects(() => applyStorageConfiguration(fresh, { approvedPlanId: fresh.planId,
    home, category: 'models', target: destination }), /locator changed/);
  // Losing a receipt must fail closed, never silently fall back to legacy data.
  const receipt = await fs.readFile(applied.receiptFile);
  await fs.unlink(applied.receiptFile);
  assert.equal(readStorageLocator(home).status, 'invalid');
  await fs.writeFile(applied.receiptFile, receipt);
  await fs.appendFile(applied.receiptFile, ' ');
  assert.equal(readStorageLocator(home).status, 'invalid');
} finally { await rmDirRecursive(temporary); }
console.log('storage reviewed configuration selection passed');
