import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { retainRepoCacheAccess, repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { getDelegatedRepoCacheOwner, settleDelegatedRepoCacheOwner } from '../../../src/shared/cache/repo-access-delegation.js';

// This entry is imported only after the managed IPC preload admits this exact
// child. It exercises a real native SQLite handle, never a Promise-only stand-in.
const [mode, root, coordinationRoot] = process.argv.slice(2);
const owner = getDelegatedRepoCacheOwner();
if (!owner || owner.root !== repoAccessPaths(root, coordinationRoot ? { coordinationRoot } : {}).root) {
  throw new Error('Native fixture was imported without exact delegated ownership.');
}
retainRepoCacheAccess(root, coordinationRoot ? { coordinationRoot } : {});
const database = new DatabaseSync(path.join(root, 'fixture.sqlite'));
database.exec('CREATE TABLE IF NOT EXISTS fixture (value TEXT)');
database.exec("INSERT INTO fixture VALUES ('owned')");
database.close();
if (mode === 'forged-receipt') {
  process.send({ protocol: 'pairofcleats-cache-delegation-v1', type: 'settled', receipt: {
    sessionId: 'another-session', childPid: process.pid + 1, childNonce: '0'.repeat(64), invocationId: owner.invocationId,
    resourceId: owner.resourceId, handlesClosed: true, descendantsSettled: true, pending: false
  }, signature: '0'.repeat(64) });
} else if (mode === 'failed-settlement-send') {
  const originalSend = process.send;
  const receipt = { resourceId: owner.resourceId, handlesClosed: true, descendantsSettled: true, pending: false };
  const failure = Object.freeze(new Error('original settlement transmission failed'));
  let completeSend, sends = 0;
  try {
    process.send = function (message, callback) {
      assert.equal(message.type, 'settled');
      sends++;
      completeSend = callback;
      return true;
    };
    const observe = promise => promise.then(() => assert.fail('failed send cannot confirm settlement'), error => error);
    const first = observe(settleDelegatedRepoCacheOwner(receipt));
    const second = observe(settleDelegatedRepoCacheOwner(receipt));
    await Promise.resolve();
    assert.equal(sends, 1, 'concurrent callers join one actual settlement transmission');
    assert.equal(getDelegatedRepoCacheOwner().settled, false, 'in-flight IPC is not confirmed settlement');
    assert.throws(() => retainRepoCacheAccess(root, coordinationRoot ? { coordinationRoot } : {}), /settlement starts/);
    completeSend(failure);
    assert.equal(await first, failure);
    assert.equal(await second, failure);
    assert.equal(getDelegatedRepoCacheOwner().settled, false, 'failed IPC cannot publish local settlement');
    assert.throws(() => retainRepoCacheAccess(root, coordinationRoot ? { coordinationRoot } : {}), /settlement starts/);
    assert.equal(await observe(settleDelegatedRepoCacheOwner(receipt)), failure);
    assert.equal(sends, 1, 'unknown delivery cannot replay the one-use authenticated receipt');
  } finally { process.send = originalSend; }
  console.log('original settlement send failure controls passed');
} else if (mode === 'settled') {
  await settleDelegatedRepoCacheOwner({ resourceId: owner.resourceId, handlesClosed: true, descendantsSettled: true, pending: false });
  assert.equal(getDelegatedRepoCacheOwner().settled, true);
  assert.throws(() => retainRepoCacheAccess(root, coordinationRoot ? { coordinationRoot } : {}), /settlement starts/);
  console.log('actual settlement transmission controls passed');
}
