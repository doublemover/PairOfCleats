import { createCacheFixtureExecutions } from './query-cache-fixture.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-query-touch-resource-fence-'));
const cachePath = path.join(root, 'results.json');
const atomicUrl = new URL('../../../src/shared/io/atomic-write.js', import.meta.url).href;
const actualUrl = `${atomicUrl}?query-touch-original-resource=actual`;
const key = Symbol.for('poc.tests.query-touch-original-resource');
const hook = registerHooks({ load(url, context, next) {
  if (url === atomicUrl) return { format: 'module', shortCircuit: true, source:
    `export * from ${JSON.stringify(actualUrl)};
import { atomicWriteJson as actual } from ${JSON.stringify(actualUrl)};
export const atomicWriteJson = (...args) => globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(key))})](actual, args);` };
  return next(url, context);
} });
let released = false;
let publications = 0;
let originalSession;
const original = Object.assign(new Error('original unsettled publication'), {
  cacheOwnershipPending: true,
  cacheOwnershipReleased() { assert.equal(this, original); return released; }
});
globalThis[key] = async (actual, args) => {
  if (path.resolve(String(args[0])) === `${cachePath}.touches.json`) {
    publications++;
    if (!released) throw original;
  }
  return actual(...args);
};
try {
  const { persistQueryCacheTouch, awaitQueryCacheTouchPublication } = await import('../../../src/retrieval/query-cache-touches.js');
  const { persistSearchSession } = await import('../../../src/retrieval/cli/run-search-session/persist.js');
  const touch = () => persistQueryCacheTouch({ cachePath, key: 'key', signature: 'generation', payloadId: 'payload', ts: 1 });
  const pendingFailure = error => { assert.equal(error.cacheOwnershipPending, true); return true; };
  await assert.rejects(touch(), error => {
    originalSession = error.fileLockPublicationSession;
    assert.ok(originalSession, 'the canonical lock owner retains its exact metadata publication session');
    return pendingFailure(error);
  });
  original.cacheOwnershipReleased = () => true;
  await assert.rejects(touch(), pendingFailure);
  await assert.rejects(awaitQueryCacheTouchPublication(cachePath), pendingFailure);
  await assert.rejects(persistSearchSession({ executionOutcomes: createCacheFixtureExecutions(), queryCacheEnabled: true, cacheKey: 'new-miss', cacheHit: false,
    cacheData: { version: 1, entries: [] }, queryCachePath: cachePath, cacheSignature: 'generation',
    codeHits: [], proseHits: [], extractedProseHits: [], recordHits: [], queryCacheMaxEntries: 8 }), pendingFailure);
  assert.equal(publications, 1, 'neither a later touch nor a canonical miss checkpoint can bypass the original unresolved resource');
  released = true;
  const receipt = await originalSession.releaseAfterClose();
  assert.equal(receipt.settled, true, 'the exact original lock owner explicitly retires its retained metadata');
  assert.equal(await touch(), true);
  assert.equal(publications, 2, 'deliberate retry is admitted after the original prerequisite confirms settlement');
} finally {
  released = true;
  await originalSession?.releaseAfterClose();
  hook.deregister(); delete globalThis[key];
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Actual touch and query-session owners retain original publication settlement across callback replacement and fallback attempts.');
