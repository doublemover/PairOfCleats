import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createVfsQueuedWriteBatcher } from '../../../src/integrations/tooling/providers/lsp/vfs-batching.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('vfs-drain');
const open = fs.open;
let release = () => {};
const active = [];
try {
  const batching = { maxInflight: 2, maxQueueEntries: 32, maxBatchBytes: 65536 };
  for (const secondaryFails of [false, true]) {
    const rootDir = path.join(dir, secondaryFails ? 'dual' : 'primary');
    let reachedB, reachedA, aCalls = 0, cCalls = 0, bWrites = 0, completed = false;
    const bEntered = new Promise(resolve => { reachedB = resolve; });
    const aFailed = new Promise(resolve => { reachedA = resolve; });
    const hold = new Promise(resolve => { release = resolve; });
    const denied = Object.assign(new Error('fixture A publication denied'), { code: 'EACCES' });
    fs.open = async (target, flags, ...args) => {
      if (flags === 'wx' && String(target).replaceAll('\\', '/').includes('/failure-a/')) {
        await bEntered; if (++aCalls === 2) reachedA(); throw denied;
      }
      const handle = await open.call(fs, target, flags, ...args);
      if (flags === 'wx' && String(target).replaceAll('\\', '/').includes('/held-b/')) {
        const write = handle.writeFile.bind(handle);
        handle.writeFile = async (...values) => { bWrites++; reachedB(); await hold;
          if (secondaryFails) throw Object.assign(new Error('fixture B write failed'), { code: 'EIO' });
          return write(...values);
        };
      }
      if (flags === 'wx' && String(target).replaceAll('\\', '/').includes('/late-c/')) cCalls++;
      return handle;
    };
    const queue = createVfsQueuedWriteBatcher({ rootDir, batching });
    for (const name of ['failure-a', 'held-b', 'late-c']) await queue.enqueue({ virtualPath: `.poc-vfs/${name}/document.js`, text: name, docHash: name });
    const flushed = queue.flush(); active.push(flushed);
    flushed.then(() => { completed = true; }, () => { completed = true; });
    await aFailed; await new Promise(setImmediate);
    assert.equal(completed, false, 'batch rejection must wait for the active original sibling');
    assert.equal(cCalls, 0, 'terminal failure stops claiming later documents');
    release(); await assert.rejects(flushed, error => {
      const seen = new Set(), messages = [];
      const visit = value => { if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value); if (typeof value.message === 'string') messages.push(value.message);
        visit(value.cause); for (const child of value.errors || []) visit(child);
      };
      visit(error); assert.ok(messages.some(value => value.includes('fixture A publication denied')));
      if (secondaryFails) assert.ok(messages.some(value => value.includes('fixture B write failed')));
      return true;
    });
    assert.equal(cCalls, 0); assert.equal(bWrites, secondaryFails ? 2 : 1, 'ordinary settled write retries keep their original policy');
    assert.deepEqual(queue.warnings.map(value => value.code).filter(value => value === 'VFS_WRITE_FAILED'),
      Array(secondaryFails ? 2 : 1).fill('VFS_WRITE_FAILED'));
    fs.open = open;
  }
  // Coalescing before publication remains intentionally last-write-wins.
  const rootDir = path.join(dir, 'coalescing'), queue = createVfsQueuedWriteBatcher({ rootDir, batching });
  await queue.enqueue({ virtualPath: '.poc-vfs/updated.js', text: 'before', docHash: 'before' });
  await queue.enqueue({ virtualPath: '.poc-vfs/updated.js', text: 'latest', docHash: 'latest' });
  const result = await queue.drain();
  assert.equal(await fs.readFile(result.get('.poc-vfs/updated.js'), 'utf8'), 'latest');
} finally {
  release(); fs.open = open;
  try { await Promise.allSettled(active); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
}
console.log('VFS batched failure stops new work, joins original siblings and preserves both failures and ordered coalescing.');
