import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { applyStorageLocatorSelections } from '../../../src/shared/storage/selected-layout.js';
import { planStorageConfiguration, applyStorageConfiguration } from '../../../src/shared/storage/configuration.js';
import { planManagedChildStorage, prepareManagedChildStorage } from '../../../src/shared/storage/child-environment.js';

const windows = resolveStorageLayout({ home: 'C:\\home', platform: 'win32', cwd: 'C:\\launch', env: {} });
const locator = { status: 'present', target: 'C:\\home\\config\\storage-locations.json', sha256: 'a'.repeat(64),
  value: { schemaVersion: 1, categories: { cache: { path: 'D:\\selected-cache', migrationId: 'b'.repeat(64) },
    tmp: { path: 'E:\\selected-tmp', migrationId: 'c'.repeat(64) } } } };
const selected = applyStorageLocatorSelections(windows, locator);
assert.equal(selected.descriptors.cache.path, 'D:\\selected-cache');
assert.equal(selected.descriptors.shared.path, 'D:\\selected-cache\\shared');
assert.equal(selected.descriptors.tmp.source, 'locator.categories.tmp');
assert.equal(selected.descriptors.tmp.deletionAuthority, false);
assert.equal(windows.descriptors.cache.path, 'C:\\home\\cache', 'pure overlay cannot mutate base intent');
const explicit = resolveStorageLayout({ home: 'C:\\home', platform: 'win32', cwd: 'C:\\launch',
  env: { PAIROFCLEATS_CACHE_ROOT: 'F:\\explicit' } });
const shadowed = applyStorageLocatorSelections(explicit, locator);
assert.equal(shadowed.descriptors.cache.path, 'F:\\explicit\\cache');
assert.deepEqual(applyStorageLocatorSelections(shadowed, locator), shadowed, 'overlays are idempotent even for shadowed selections');
assert.throws(() => applyStorageLocatorSelections(windows, { ...locator, target: 'C:\\other\\config\\storage-locations.json' }), { code: 'ERR_STORAGE_LOCATOR' });

const temporary = await makeTempDir('poc-managed-selected-layout-');
try {
  const home = path.join(temporary, 'home');
  const source = path.join(home, 'cache', 'tmp');
  const target = path.join(home, 'selected-scratch');
  await fs.mkdir(source, { recursive: true });
  const layout = resolveStorageLayout({ home, env: {} });
  const input = { baseEnv: {}, layout, command: 'npm', managed: true, toolId: 'fixture', toolIdentity: 'fixture-v1' };
  const before = planManagedChildStorage({ ...input, runId: 'before' });
  const reviewed = await planStorageConfiguration({ layout, category: 'tmp', currentPath: source, target });
  await applyStorageConfiguration(reviewed, { approvedPlanId: reviewed.planId, home, category: 'tmp', target });
  await assert.rejects(prepareManagedChildStorage(before, { authorizedRoots: [temporary] }), /selection changed after planning/);
  await assert.rejects(fs.lstat(before.scratch), { code: 'ENOENT' });
  const after = planManagedChildStorage({ ...input, runId: 'after' });
  assert.equal(after.scratch.startsWith(path.join(target, 'managed-children') + path.sep), true,
    'the actual installed caller helper consumes the verified selection');
  await prepareManagedChildStorage(after, { authorizedRoots: [temporary] });
  assert.equal((await fs.lstat(path.join(after.scratch, '.pairofcleats-child-owner.json'))).isFile(), true);
} finally { await rmDirRecursive(temporary); }
console.log('selected storage layout managed routing passed');
