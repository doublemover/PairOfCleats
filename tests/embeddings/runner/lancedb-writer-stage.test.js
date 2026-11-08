import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLanceDbWriterStage } from '../../../tools/build/embeddings/lancedb-writer-stage.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir: root } = await prepareIsolatedTestCacheDir('lancedb-writer-stage');
try {
  const stage = await createLanceDbWriterStage(root);
  const calls = [];
  let allowClose = false;
  const closeError = Object.freeze(new Error('controlled table close failure'));
  stage.acquire({ close() { calls.push('connection'); } }, 'connection');
  stage.acquire({ close() { calls.push('table'); if (!allowClose) throw closeError; } }, 'table');
  await fs.writeFile(path.join(stage.dir, 'retained'), 'original bytes');
  await assert.rejects(stage.closeResources(), error => error === closeError);
  assert.deepEqual(calls, ['table']);
  assert.equal(await fs.readFile(path.join(stage.dir, 'retained'), 'utf8'), 'original bytes');
  await assert.rejects(stage.publishTo(path.join(root, 'published')), /before native resources close/);
  allowClose = true;
  await stage.close();
  assert.deepEqual(calls, ['table', 'table', 'connection']);
  assert.equal(stage.pending, false);

  const observed = await createLanceDbWriterStage(root);
  let released = false;
  const original = Object.freeze(Object.assign(new Error('original work remains pending'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => released
  }));
  observed.observe(original);
  await assert.rejects(observed.close());
  assert.equal((await fs.stat(observed.dir)).isDirectory(), true);
  released = true;
  await observed.close();
  assert.equal(observed.pending, false);

  const changed = await createLanceDbWriterStage(root);
  const originalPath = `${changed.dir}-retained`;
  await fs.rename(changed.dir, originalPath);
  await fs.mkdir(changed.dir);
  await fs.writeFile(path.join(changed.dir, 'foreign'), 'foreign bytes');
  await assert.rejects(changed.close(), { code: 'ERR_PERSISTENCE_DIRECTORY_CHANGED' });
  assert.equal(await fs.readFile(path.join(changed.dir, 'foreign'), 'utf8'), 'foreign bytes');
  assert.equal((await fs.stat(originalPath)).isDirectory(), true);
  assert.equal(changed.pending, true);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Compact Lance writer staging retains original work and native shutdown ordering, and refuses foreign roots.');
