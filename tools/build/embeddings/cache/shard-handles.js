import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkPath, verifyContainedFileHandle } from '../../../../src/shared/contained-file.js';
import { acquireEmbeddingProfileSession } from './profile-access.js';
import { retainSessionFailure } from '../../../../src/shared/storage/session.js';

/** Bounded append descriptors retain their profile lease until original close
 * succeeds. Failed native closure exposes the same retry owner, never a cleared map. */
export const createShardAppendHandlePool = () => {
  const handles = new Map();
  let pool;
  const closeEntry = async (filename, entry) => {
    try {
      if (!entry.closed) {
        const result = await entry.close();
        if (result !== undefined) throw new Error('Shard descriptor close did not confirm its standard void result.');
        entry.closed = true;
      }
      entry.session?.releaseAfterSettlement({ resourceId: entry.session.resourceId, settled: true, pending: false });
      handles.delete(filename);
    } catch (error) {
      const pending = Object.assign(new AggregateError([error], 'Embedding shard descriptor closure remains unconfirmed.', { cause: error }), {
        code: 'ERR_EMBEDDING_CACHE_HANDLE_CLOSE_PENDING', cacheOwnershipPending: true,
        cacheOwnershipReleased: () => !handles.has(filename), shardHandlePool: pool
      });
      throw entry.session ? retainSessionFailure(error, pending, entry.session) : pending;
    }
  };
  pool = {
    async get(shardPath) {
      const existing = handles.get(shardPath);
      if (existing) {
        if (existing.closed) throw new Error('Closed shard handle still requires lease reconciliation.');
        verifyContainedFileHandle(existing.handle, existing.root, shardPath);
        return existing;
      }
      if (handles.size >= 16) {
        const [oldPath, oldEntry] = handles.entries().next().value;
        await closeEntry(oldPath, oldEntry);
      }
      const root = path.dirname(path.dirname(shardPath));
      const session = acquireEmbeddingProfileSession(shardPath);
      let entry = null;
      try {
        assertNoSymlinkPath(root, shardPath, { allowMissing: true });
        const handle = await fs.open(shardPath, 'a');
        entry = { handle, close: handle.close.bind(handle), session, root, closed: false, size: 0 };
        handles.set(shardPath, entry);
        verifyContainedFileHandle(handle, root, shardPath);
        const stat = await handle.stat();
        if (stat.nlink !== 1) throw new Error('Embedding shard append refuses unknown physical aliases.');
        entry.size = stat.size;
        return entry;
      } catch (error) {
        if (entry) {
          try { await closeEntry(shardPath, entry); }
          catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Shard acquisition and cleanup failed.', { cause: error }); }
        } else session?.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
        throw error;
      }
    },
    async close() {
      const failures = [];
      for (const [filename, entry] of handles) {
        try { await closeEntry(filename, entry); }
        catch (error) { failures.push(error); }
      }
      if (failures.length) throw Object.assign(new AggregateError(failures, 'Embedding shard handles remain retained.', { cause: failures[0] }), {
        code: 'ERR_EMBEDDING_CACHE_HANDLE_CLOSE_PENDING', cacheOwnershipPending: true,
        cacheOwnershipReleased: () => handles.size === 0, shardHandlePool: pool
      });
    },
    stats: () => ({ handles: handles.size, maxHandles: 16 })
  };
  return pool;
};
