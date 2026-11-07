import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { persistQueryCacheTouch } from '../../../src/retrieval/query-cache-touches.js';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-query-touch-flight-'));
const cachePath = path.join(root, 'results.json');
const journalPath = `${cachePath}.touches.json`;
const originalRename = fs.rename;
let publications = 0;
try {
  fs.rename = async function (source, destination) {
    const result = await originalRename.call(this, source, destination);
    if (path.resolve(String(destination)) === journalPath) publications++;
    return result;
  };
  const lock = await acquireFileLock({ lockPath: `${cachePath}.lock`, waitMs: 1000, timeoutBehavior: 'throw' });
  let settled = 0;
  let pending;
  try {
    pending = Array.from({ length: 32 }, (_, index) => persistQueryCacheTouch({ cachePath,
      key: `key-${index % 4}`, signature: 'admitted-generation', payloadId: `payload-${index % 4}`,
      ts: index, maxEntries: 8 }).finally(() => { settled++; }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, 0, 'every caller awaits its shared durable publication');
    assert.equal(publications, 0);
  } finally { await lock.release(); }
  assert.ok((await Promise.all(pending)).every(Boolean));
  assert.equal(publications, 1, 'same-turn concurrent hits coalesce under the canonical writer lock');
  const saved = JSON.parse(await fs.readFile(journalPath, 'utf8'));
  assert.equal(saved.entries.length, 4);
  for (const entry of saved.entries) assert.equal(entry.ts, 28 + Number(entry.key.slice(-1)));
  assert.ok((await fs.stat(journalPath)).size < 4096, 'work and bytes depend on touched identities');
  assert.equal(await persistQueryCacheTouch({ cachePath, key: 'key-0', signature: 'admitted-generation', payloadId: 'payload-0', ts: 0, maxEntries: 8 }), true);
  assert.equal(publications, 1, 'already durable equal/older observations do not rewrite the journal');
  assert.equal(await persistQueryCacheTouch({ cachePath, key: 'x'.repeat(300000), signature: 'g', payloadId: 'p', ts: 1 }), false);
  const boundedPath = path.join(root, 'bounded.json');
  const bounded = await Promise.all(['first', 'second'].map(key => persistQueryCacheTouch({ cachePath: boundedPath,
    key, signature: 'g', payloadId: key, ts: 1, maxEntries: 1 })));
  assert.deepEqual(bounded, [true, false], 'overflow returns to the existing full-checkpoint owner');

  const failedPath = path.join(root, 'failed.json');
  fs.rename = async function (source, destination) {
    if (path.resolve(String(destination)) === `${failedPath}.touches.json`) {
      throw Object.assign(new Error('controlled touch publication failure'), { code: 'EIO' });
    }
    return originalRename.call(this, source, destination);
  };
  await assert.rejects(persistQueryCacheTouch({ cachePath: failedPath, key: 'retry', signature: 'g', payloadId: 'p', ts: 1 }));
  fs.rename = originalRename;
  assert.equal(await persistQueryCacheTouch({ cachePath: failedPath, key: 'retry', signature: 'g', payloadId: 'p', ts: 2 }), true,
    'a failed finite flight releases its admission state for a deliberate later flush');

  const busyPath = path.join(root, 'busy.json');
  const arriving = [];
  let busyPublications = 0;
  fs.rename = async function (source, destination) {
    const result = await originalRename.call(this, source, destination);
    if (path.resolve(String(destination)) === `${busyPath}.touches.json`) {
      busyPublications++;
      if (busyPublications <= 2) arriving.push(persistQueryCacheTouch({ cachePath: busyPath,
        key: `arrival-${busyPublications}`, signature: 'g', payloadId: `p-${busyPublications}`, ts: busyPublications }));
    }
    return result;
  };
  const firstBusy = await persistQueryCacheTouch({ cachePath: busyPath, key: 'initial', signature: 'g', payloadId: 'initial', ts: 1 });
  assert.equal(firstBusy, false);
  assert.deepEqual(await Promise.all(arriving), [false, false], 'a continuously changing flight yields fallback after its finite batch budget');
  assert.equal(busyPublications, 2);
  fs.rename = originalRename;
  assert.equal(await persistQueryCacheTouch({ cachePath: busyPath, key: 'arrival-2', signature: 'g', payloadId: 'p-2', ts: 2 }), true,
    'bounded-flight overflow leaves no detached writer or permanently occupied path');
  assert.equal(JSON.parse(await fs.readFile(`${busyPath}.touches.json`, 'utf8')).entries.length, 3);
} finally {
  fs.rename = originalRename;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Query-cache touch flights coalesce concurrent identities, remain awaited and bounded, and recover after failed publication.');
