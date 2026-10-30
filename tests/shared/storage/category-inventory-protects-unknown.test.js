import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { writePersistentCommandProbeCache } from '../../../src/index/tooling/command-probe-persistent-cache.js';
import { withGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';
import { inspectStorageCategory } from '../../../tools/storage/category-inventory.js';

const temporary = await makeTempDir('poc-category-inventory-');
try {
  const home = path.join(temporary, 'home');
  const cache = path.join(home, 'cache', 'tooling');
  assert.equal(writePersistentCommandProbeCache({ providerId: 'fixture', command: process.execPath, args: ['--version'],
    cwd: temporary, probeEnv: {}, toolingConfig: { cache: { dir: cache } }, attempted: [{ ok: true }] }), true);
  const root = path.join(cache, 'command-probes');
  const unknown = path.join(root, `${'f'.repeat(40)}.json`);
  const original = JSON.stringify(withGeneratedCacheMetadata({ result: 'unknown-header-only' }, 'command-probe'));
  await fs.writeFile(unknown, original);
  const before = await fs.readdir(temporary, { recursive: true });
  const inventory = await inspectStorageCategory({ category: 'command-probes', root, home });
  assert.equal(inventory.files.filter(file => file.ownerQualified).length, 1);
  assert.equal(inventory.files.find(file => file.path === unknown).protected, true);
  assert.equal(inventory.deletionAuthority, false);
  assert.equal(await fs.readFile(unknown, 'utf8'), original);
  assert.deepEqual(await fs.readdir(temporary, { recursive: true }), before);
  await assert.rejects(inspectStorageCategory({ category: 'embedding-profiles', root, home,
    request: { schemaVersion: 1, kind: 'storage-cleanup-plan', identity: {} } }), /full-identity profile request/);
} finally { await rmDirRecursive(temporary); }
console.log('category inventory protects unknown state passed');
