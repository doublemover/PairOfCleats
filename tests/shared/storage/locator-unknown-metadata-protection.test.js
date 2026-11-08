// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { STORAGE_LOCATOR_VERSION } from '../../../src/shared/storage/locator-contract.js';
import { readStorageLocator, writeStorageLocator } from '../../../src/shared/storage/locator.js';
import { planStorageConfiguration, applyStorageConfiguration } from '../../../src/shared/storage/configuration.js';

const temporary = await makeTempDir('storage-locator-unknown-metadata-');
try {
  const home = path.join(temporary, 'home');
  const target = path.join(temporary, 'models');
  const file = path.join(home, 'config', 'storage-locations.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const layout = resolveStorageLayout({ home, env: {} });
  const entry = { path: target, migrationId: 'a'.repeat(64), owner: 'fixture-category-owner' };
  for (const value of [
    { schemaVersion: STORAGE_LOCATOR_VERSION, categories: { models: entry }, pinned: true },
    { schemaVersion: STORAGE_LOCATOR_VERSION, categories: { models: { ...entry, retainedByFutureOwner: true } } }
  ]) {
    await fs.writeFile(file, JSON.stringify(value));
    const retained = await fs.readFile(file);
    assert.equal(readStorageLocator(home).status, 'invalid');
    await assert.rejects(planStorageConfiguration({ layout, category: 'models', target }), /invalid storage locator/);
    await assert.rejects(writeStorageLocator(home, { schemaVersion: STORAGE_LOCATOR_VERSION, categories: {} }), /changed before cutover/);
    assert.deepEqual(await fs.readFile(file), retained, 'unknown metadata is not silently normalized away');
  }
  await fs.unlink(file);
  const plan = await planStorageConfiguration({ layout, category: 'models', target });
  const applied = await applyStorageConfiguration(plan, { approvedPlanId: plan.planId, home, category: 'models', target });
  assert.equal(readStorageLocator(home).status, 'present');
  const selected = readStorageLocator(home).value;
  const receipt = JSON.parse(await fs.readFile(applied.receiptFile));
  receipt.pinned = 'future-retention-owner';
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  await fs.writeFile(applied.receiptFile, receiptBytes);
  selected.categories.models.receiptHash = createHash('sha256').update(receiptBytes).digest('hex');
  await fs.writeFile(file, JSON.stringify(selected));
  const retainedLocator = await fs.readFile(file);
  assert.equal(readStorageLocator(home).status, 'invalid', 'matching bytes/hash cannot adopt unknown receipt semantics');
  await assert.rejects(planStorageConfiguration({ layout, category: 'models', target }), /invalid storage locator/);
  assert.deepEqual(await fs.readFile(file), retainedLocator);
  assert.deepEqual(await fs.readFile(applied.receiptFile), receiptBytes);
  await assert.rejects(fs.stat(target), { code: 'ENOENT' }, 'selection publication never creates the category directory');
} finally { await rmDirRecursive(temporary); }
console.log('Storage locator and configuration cutover preserve unknown retained metadata.');
