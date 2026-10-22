import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { createDictionaryMigrationOwner, inspectDictionaryStorage } from '../../../src/shared/storage/dictionary-adapter.js';
import { createStorageMigrationPlan } from '../../../src/shared/storage/migration-plan.js';
import { applyStorageMigration, applyStorageMigrationRollback } from '../../../src/shared/storage/migration.js';
import { readStorageLocator } from '../../../src/shared/storage/locator-read.js';

const temporary = await makeTempDir('poc-dictionary-migration-');
try {
  const home = path.join(temporary, 'home');
  const source = path.join(home, 'dictionaries');
  const destination = path.join(home, 'assets', 'dictionaries');
  await fs.mkdir(path.join(source, 'repos'), { recursive: true });
  await fs.mkdir(path.join(source, 'slang'), { recursive: true });
  await fs.writeFile(path.join(home, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  await fs.writeFile(path.join(source, 'dictionaries.json'), JSON.stringify({ en: { url: 'https://fixture.invalid/en.txt', file: 'en.txt',
    sha256: null, verified: false, etag: null, lastModified: null, downloadedAt: '2026-10-22T00:00:00.000Z' } }));
  await fs.writeFile(path.join(source, 'en.txt'), 'alpha\nbeta\n');
  await fs.writeFile(path.join(source, 'repos', 'repo-123456789abc.txt'), 'saved_repo_term\n');
  await fs.writeFile(path.join(source, 'slang', 'user.txt'), 'durable_user_term\n');
  const inspection = await inspectDictionaryStorage({ root: source });
  assert.equal(inspection.files.some(file => file.kind === 'durable-repository-dictionary' && file.deletionAuthority === false), true);
  const input = { category: 'dictionaries', source, destination, home, recoveryRoot: path.join(home, 'recovery'),
    coordinationRoot: path.join(home, 'state', 'storage-access'), authorityRoots: [home] };
  const defaultOwner = createDictionaryMigrationOwner({ home, source });
  const blocked = await createStorageMigrationPlan({ ...input, owner: defaultOwner });
  assert.equal(blocked.ready, false, 'mode/stat observations do not invent permission equivalence');
  assert.equal(blocked.blocked.some(item => /permission|acl/u.test(item.reason)), true);
  // This fixture supplies its own explicit permission disposition owner. It is
  // not Windows ACL, consumer-parity or real migration acceptance evidence.
  const owner = createDictionaryMigrationOwner({ home, source,
    permissionOwner: async () => ({ compatible: true, identity: 'fixture-task-directory-permission-owner-v1' }) });
  const plan = await createStorageMigrationPlan({ ...input, owner });
  assert.equal(plan.ready, true);
  const result = await applyStorageMigration(plan, { approvedPlanId: plan.planId, authorityRoots: [home], owner,
    checkFreeSpace: async () => ({ complete: true, availableBytes: 1024 * 1024, reserveSatisfied: true }) });
  assert.equal(result.complete, true);
  const selected = readStorageLocator(home).value.categories.dictionaries.path;
  for (const relative of ['en.txt', 'repos/repo-123456789abc.txt', 'slang/user.txt']) {
    assert.deepEqual(await fs.readFile(path.join(selected, relative)), await fs.readFile(path.join(source, relative)));
  }
  await applyStorageMigrationRollback(plan, { approvedPlanId: plan.planId, authorityRoots: [home], owner });
  assert.equal(await fs.readFile(path.join(selected, 'repos', 'repo-123456789abc.txt'), 'utf8'), 'saved_repo_term\n');
  const unknown = path.join(home, 'unqualified-dictionaries');
  await fs.cp(source, unknown, { recursive: true });
  await fs.writeFile(path.join(unknown, 'saved-review.log'), 'retained unknown evidence');
  await assert.rejects(inspectDictionaryStorage({ root: unknown }), /Unregistered dictionary bytes/);
  assert.equal(await fs.readFile(path.join(unknown, 'saved-review.log'), 'utf8'), 'retained unknown evidence');
} finally { await rmDirRecursive(temporary); }
console.log('dictionary category migration passed');
