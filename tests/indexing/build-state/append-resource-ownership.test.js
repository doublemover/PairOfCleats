import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeBuildStateText } from '../../../src/index/build/build-state/store-io.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';

// UNVALIDATED: original opened FileHandle, no symlinks, child or native addon.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['ordinary', 'write-close', 'pending-write', 'pending-sync', 'close-only', 'missing-root'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'state-append-')), file = path.join(root, 'events.jsonl');
const open = fs.open; let ready = false, closes = 0, writes = 0, syncs = 0, dispose;
const primary = Object.assign(new Error('original append fault'), {
  cacheOwnershipReleased() { assert.equal(this, primary); return ready; }
});
const closeError = Object.freeze(new Error('actual close rejected'));
try {
  if (selected === 'missing-root') await fs.rm(root, { recursive: true });
  else await fs.writeFile(file, 'before\n');
  fs.open = async (target, ...args) => {
    const actual = await open(target, ...args);
    if (target !== file) return actual;
    dispose = actual.close.bind(actual);
    const owned = { get fd() { return actual.fd; }, read: actual.read.bind(actual), stat: actual.stat.bind(actual),
      async writeFile(...values) {
        assert.equal(this, owned); writes++;
        if (selected === 'pending-write' || selected === 'write-close') throw primary;
        return actual.writeFile(...values);
      }, async sync() {
        assert.equal(this, owned); syncs++;
        if (selected === 'pending-sync') throw primary;
        return actual.sync();
      }, async close() {
        assert.equal(this, owned); closes++;
        if ((selected === 'write-close' || selected === 'close-only') && closes === 1) throw closeError;
        await actual.close(); dispose = null;
      } };
    return owned;
  };
  if (selected === 'ordinary') {
    await writeBuildStateText(file, 'after\n', { append: true, durable: true });
    assert.equal(await fs.readFile(file, 'utf8'), 'before\nafter\n'); assert.equal(closes, 1); assert.equal(syncs, 1);
  } else if (selected === 'missing-root') {
    await assert.rejects(writeBuildStateText(file, 'never', { append: true, durable: true }), { code: 'ENOENT' });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' }); assert.equal(writes, 0);
  } else {
    // Both independent write and close fail, after the original write settles.
    if (selected === 'write-close') ready = true;
    let failure;
    try { await writeBuildStateText(file, 'after\n', { append: true, durable: true }); }
    catch (error) { failure = error; }
    assert.ok(failure); const session = getContainedFileSession(failure); assert.ok(session);
    assert.equal(failure.cacheOwnershipReleased(), false);
    if (selected.startsWith('pending')) {
      assert.equal(closes, 0, 'pending original operation prohibits close');
      await assert.rejects(session.releaseAfterClose()); assert.equal(closes, 0);
    }
    ready = true; await session.releaseAfterClose();
    assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(writes, 1, 'recovery never repeats append');
    assert.equal(closes, selected === 'write-close' || selected === 'close-only' ? 2 : 1);
    assert.equal(await fs.readFile(file, 'utf8'), ['pending-write', 'write-close'].includes(selected) ? 'before\n' : 'before\nafter\n');
  }
} finally { ready = true; fs.open = open; if (dispose) await dispose(); await fs.rm(root, { recursive: true, force: true }); }
console.log(`Build-state append original descriptor ownership: ${selected}`);
