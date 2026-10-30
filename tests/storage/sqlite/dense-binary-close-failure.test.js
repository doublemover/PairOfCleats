import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadSqliteIndexOptionalArtifacts } from '../../../src/storage/sqlite/utils.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir: root } = await prepareIsolatedTestCacheDir('sqlite-dense-close-failure');
const file = path.join(root, 'dense_vectors_uint8.bin');
await fs.writeFile(file, Buffer.from([1, 2, 3, 4, 5, 6]));
await fs.writeFile(`${file}.meta.json`, JSON.stringify({ format: 'uint8-row-major', path: path.basename(file), count: 2, dims: 3 }));
const originalOpen = fs.open;
try {
  await withTemporaryEnv({ PAIROFCLEATS_DENSE_BINARY_MAX_INLINE_MB: '0.000001' }, async () => {
    for (const earlyReturn of [false, true]) {
      let closeAttempts = 0, replacementCalls = 0, originalHandle;
      fs.open = async (target, ...args) => {
        const handle = await originalOpen(target, ...args);
        if (target === file) {
          originalHandle = handle;
          const close = handle.close.bind(handle);
          handle.close = async () => { if (++closeAttempts === 1) throw new Error('native close unconfirmed'); await close(); };
        }
        return handle;
      };
      const artifact = loadSqliteIndexOptionalArtifacts(root).denseVec;
      assert.equal(artifact.streamed, true);
      let failure, rows = 0;
      await assert.rejects(async () => {
        for await (const row of artifact.rows) { assert.equal(row.docId, rows++); if (earlyReturn) break; }
      }, error => { failure = error; return error.cacheOwnershipPending === true; });
      assert.equal(rows, earlyReturn ? 1 : 2);
      assert.equal(closeAttempts, 1);
      assert.equal(failure.cacheOwnershipReleased(), false);
      originalHandle.close = async () => { replacementCalls++; };
      const session = getContainedFileSession(failure);
      assert.ok(session);
      await session.releaseAfterClose();
      assert.equal(closeAttempts, 2); assert.equal(replacementCalls, 0);
      assert.equal(failure.cacheOwnershipReleased(), true);
      assert.equal((await artifact.rows.next()).done, true, 'recovery cannot resume or publish the failed iterator');
      fs.open = originalOpen;
    }
  });
} finally { fs.open = originalOpen; await fs.rm(root, { recursive: true, force: true }); }
console.log('The SQLite optional dense consumer propagates original close failure on exhaustion and early return.');
