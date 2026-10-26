import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { VFS_COLD_START_DIR, VFS_COLD_START_META, VFS_COLD_START_DATA } from '../../../src/index/tooling/vfs/constants.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('vfs-revision');
const source = new URL('../../../src/index/tooling/vfs/cold-start.js', import.meta.url).href;
const writer = new URL('../../../src/shared/json-stream/jsonl-write.js', import.meta.url).href;
let entered, release;
const started = new Promise(resolve => { entered = resolve; }), hold = new Promise(resolve => { release = resolve; });
const state = { held: true, entered, hold, snapshots: [] };
globalThis.vfsColdFlushFixture = state;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === source + '?revision-fixture' && specifier === '../../../shared/json-stream/jsonl-write.js') {
    return { url: 'vfs-flush-revision:writer', shortCircuit: true };
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (url === 'vfs-flush-revision:writer') return { format: 'module', shortCircuit: true, source: `
    import {writeJsonLinesFile as real} from ${JSON.stringify(writer)};
    export const writeJsonLinesFile=async(file,entries,options)=>{
      const state=globalThis.vfsColdFlushFixture;state.snapshots.push(entries.map(value=>value.docHash));
      if(state.held){state.held=false;state.entered();await state.hold;}
      return real(file,entries,options);
    };` };
  return next(url, context);
} });
const pending = [];
try {
  const { createVfsColdStartCache } = await import(source + '?revision-fixture');
  const cache = await createVfsColdStartCache({ cacheRoot: dir, indexSignature: 'source', manifestHash: 'manifest',
    config: { enabled: true, cacheRoot: dir, maxBytes: 800 } });
  const row = (virtualPath, docHash) => ({ virtualPath, docHash, diskPath: path.join(dir, virtualPath), sizeBytes: 250 });
  cache.set(row('first', 'before'));
  const first = cache.flush(); pending.push(first); first.catch(() => {});
  await started;
  cache.set(row('first', 'updated')); cache.set(row('second', 'second'));
  assert.notEqual(cache.stats().revision, cache.stats().persistedRevision);
  assert.equal(cache.stats().flushInFlight, true);
  const second = cache.flush(); pending.push(second); second.catch(() => {});
  release(); await Promise.all([first, second]);
  assert.deepEqual(state.snapshots, [['before'], ['updated', 'second']]);
  assert.equal(cache.stats().flushes, 2); assert.equal(cache.stats().revision, cache.stats().persistedRevision);
  assert.equal(cache.stats().flushInFlight, false); assert.equal(cache.stats().snapshotEntriesHighWater, 2);
  const meta = JSON.parse(await fs.readFile(path.join(dir, VFS_COLD_START_DIR, VFS_COLD_START_META), 'utf8'));
  const rows = (await fs.readFile(path.join(dir, VFS_COLD_START_DIR, VFS_COLD_START_DATA), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(meta.entries, 2); assert.equal(meta.bytes, 500);
  assert.deepEqual(rows.map(value => value.docHash), ['updated', 'second']);
} finally {
  release();
  try { await Promise.allSettled(pending); }
  finally { hooks.deregister(); delete globalThis.vfsColdFlushFixture; await fs.rm(dir, { recursive: true, force: true }); }
}
console.log('VFS cache flush snapshots stay bounded and immutable while concurrent sets retain their publication revision.');
