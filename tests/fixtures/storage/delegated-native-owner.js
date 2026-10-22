import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { retainRepoCacheAccess } from '../../../src/shared/cache/repo-access.js';
import { getDelegatedRepoCacheOwner, settleDelegatedRepoCacheOwner } from '../../../src/shared/cache/repo-access-delegation.js';

// This entry is imported only after the managed IPC preload admits this exact
// child. It exercises a real native SQLite handle, never a Promise-only stand-in.
const [mode, root, coordinationRoot] = process.argv.slice(2);
const owner = getDelegatedRepoCacheOwner();
if (!owner || owner.root !== root) throw new Error('Native fixture was imported without exact delegated ownership.');
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
} else if (mode === 'settled') {
  await settleDelegatedRepoCacheOwner({ resourceId: owner.resourceId, handlesClosed: true, descendantsSettled: true, pending: false });
}
