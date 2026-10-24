import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: preserve the actual path-only low-level lock's import boundary.
let storageLoads = 0;
const hooks = registerHooks({ load(url, context, next) {
  if (url.endsWith('/src/index/build/storage-session.js')) { storageLoads++; throw new Error('path-only locks must not load storage launch resolution'); }
  return next(url, context);
} });
const temporary = await makeTempDir('poc-index-lock-lazy-');
try {
  const { acquireIndexLock } = await import('../../../src/index/build/lock.js');
  const lock = await acquireIndexLock({ repoCacheRoot: path.join(temporary, 'repo'), requireSettlement: true });
  assert.equal(storageLoads, 0);
  await lock.release();
  await assert.rejects(acquireIndexLock({ repoCacheRoot: path.join(temporary, 'other'), storageContext: {} }), /must not load storage/);
  assert.equal(storageLoads, 1, 'only explicit launch coordination loads the bridge');
} finally { hooks.deregister(); await rmDirRecursive(temporary); }
console.log('Path-only index locks retain lazy storage coupling.');
