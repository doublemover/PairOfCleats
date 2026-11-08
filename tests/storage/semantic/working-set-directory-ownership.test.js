import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { reopenSemanticDiskAccount } from '../../../src/index/build/incremental/working-set.js';
import { getStorageDirectorySession } from '../../../src/shared/storage/directory.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('storage/semantic/working-set-directory-ownership/')[1];
assert.ok(['pending-close', 'pending-read', 'falsey-stat', 'pending-stat-diagnostic'].includes(mode));
const { dir } = await prepareIsolatedTestCacheDir('working-set-directory-ownership');
const filename = path.join(dir, 'input.bin'); await fs.writeFile(filename, 'bounded inventory input');
const opendir = fs.opendir, lstat = fs.lstat;
let ready = false, closes = 0, session, actual, codeReads = 0;
const native = Object.assign(new Error('original inventory native work'), {
  cacheOwnershipReleased() { assert.equal(this, native); return ready; }
});
Object.defineProperty(native, 'code', { get() { codeReads++; native.cacheOwnershipReleased = () => true; return 'ENOENT'; } });
const rejected = async operation => {
  let failed = false, failure;
  try { await operation(); } catch (error) { failed = true; failure = error; }
  assert.equal(failed, true); return failure;
};
try {
  if (mode === 'falsey-stat') {
    for (const value of [undefined, null, false, 0, '', Object.freeze(new Error('frozen metadata failure'))]) {
      fs.lstat = async () => { throw value; };
      assert.equal(await rejected(() => reopenSemanticDiskAccount({ roots: [dir], limit: 65536 })), value);
    }
  } else if (mode === 'pending-stat-diagnostic') {
    fs.lstat = async () => { throw native; };
    const failure = await rejected(() => reopenSemanticDiskAccount({ roots: [dir], limit: 65536 }));
    assert.equal(codeReads, 0, 'ENOENT diagnostics cannot replace an outstanding original observer');
    assert.equal(failure.cacheOwnershipReleased(), false);
    native.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  } else {
    fs.opendir = async (...args) => {
      actual = await opendir(...args);
      return { read: async () => { if (mode === 'pending-read') throw native; return actual.read(); },
        close: async () => { closes++; if (mode === 'pending-close' && !ready) throw native; await actual.close(); },
        async *[Symbol.asyncIterator]() {
          try { for (;;) { const entry = await this.read(); if (!entry) break; yield entry; } }
          finally { await this.close(); }
        } };
    };
    const failure = await rejected(() => reopenSemanticDiskAccount({ roots: [dir], limit: 65536 }));
    assert.equal(codeReads, 0); assert.equal(failure.cacheOwnershipReleased(), false);
    session = getStorageDirectorySession(failure);
    assert.equal(typeof session?.releaseAfterClose, 'function');
    assert.equal(closes, mode === 'pending-read' ? 0 : 1);
    native.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false, 'the actual original callback stays captured');
    ready = true;
    assert.equal((await session.releaseAfterClose()).settled, true);
    assert.equal(closes, mode === 'pending-read' ? 1 : 2);
    assert.equal(failure.cacheOwnershipReleased(), true);
    fs.opendir = opendir;
    const inventory = await reopenSemanticDiskAccount({ roots: [dir], limit: 65536 });
    assert.equal(inventory.retainedFiles, 1); assert.equal(inventory.retainedBytes, Buffer.byteLength('bounded inventory input'));
  }
} finally {
  fs.opendir = opendir; fs.lstat = lstat; ready = true;
  if (session) await session.releaseAfterClose(); else if (actual) await actual.close();
  assert.ok(path.relative(process.cwd(), dir).startsWith(`.tmp${path.sep}`));
  await fs.rm(dir, { recursive: true, force: true });
}
