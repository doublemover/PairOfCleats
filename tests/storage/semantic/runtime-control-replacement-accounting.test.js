import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withRuntimeDestinationWriter } from '../../../src/index/semantic/runtime/ownership.js';
import { createRuntimePublicationWork } from '../../../src/index/semantic/runtime/publication-reuse.js';
import { publishRuntimeControl } from '../../../src/index/semantic/runtime/control-publication.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { retainedRuntimeBytes } from '../../helpers/runtime-publication-work.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('storage/semantic/runtime-control-replacement-accounting/')[1];
assert.ok(['unique', 'hardlinked'].includes(mode));
const { dir } = await prepareIsolatedTestCacheDir('runtime-control-accounting'), root = path.join(dir, 'publication');
await fs.mkdir(root);
const current = path.join(root, 'current.json'), alias = path.join(root, 'retained-control.json');
const previous = Buffer.from(JSON.stringify({ original: 'retained original control payload'.repeat(16) }));
const replacement = Buffer.from(JSON.stringify({ replacement: 'new independently owned control payload'.repeat(16) }));
const shared = createSemanticDiskAccount(8192), metrics = {}, work = createRuntimePublicationWork(metrics);
try {
  await fs.writeFile(current, previous);
  // A real task-owned hardlink proves physical inventory sharing; this creates
  // no symlink/reparse point and needs no elevated token or setting change.
  if (mode === 'hardlinked') await fs.link(current, alias);
  await withRuntimeDestinationWriter({ destination: root, maxDiskWorkingSetBytes: shared.limit, diskAccount: shared, work },
    async ({ destination, account }) => {
      assert.equal(await publishRuntimeControl({ root: destination, relativePath: 'current.json',
        bytes: replacement, account, diskReserveBytes: 0, work }), true);
      const physical = await retainedRuntimeBytes(destination);
      assert.ok(account.used >= physical, 'renaming one control name cannot return credits for an old inode retained by another name');
      assert.ok(account.used <= account.limit);
      assert.deepEqual(await fs.readFile(current), replacement);
      if (mode === 'hardlinked') assert.deepEqual(await fs.readFile(alias), previous);
    });
  assert.equal(shared.used, await retainedRuntimeBytes(root), 'the destination owner reconciles exact retained physical bytes after control replacement');
  console.log(JSON.stringify({ mode, beforeBytes: previous.length, replacementBytes: replacement.length,
    retainedBytes: shared.used, metrics }));
} finally {
  assert.ok(path.relative(process.cwd(), dir).startsWith(`.tmp${path.sep}`));
  await fs.rm(dir, { recursive: true, force: true });
}
