import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { persistenceDirectoryIdentity, assertPersistenceDirectoryIdentity } from '../../../src/shared/io/directory-identity.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { createLanceDbResourceOwner } from '../../../src/retrieval/ann/lancedb-lifetime.js';
import { replaceDir } from './atomic.js';

/** Keep native write paths compact within the same generation. Publication
 * retains its existing journal/layout and receives only a fully closed payload.
 */
export const createLanceDbWriterStage = async indexDir => {
  const parent = path.resolve(indexDir);
  assertNoSymlinkPath(parent, parent);
  const parentIdentity = persistenceDirectoryIdentity(await fs.lstat(parent, { bigint: true }));
  const dir = await fs.mkdtemp(path.join(parent, '.lb-'));
  const identity = persistenceDirectoryIdentity(await fs.lstat(dir, { bigint: true }));
  const resources = [], observations = [];
  let transferred = false, removed = false, flight = null, overflow = false;
  const observe = error => {
    if (observations.length === 128) overflow = true;
    else observations.push(observeStorageResource(error, { phase: 'lancedb-writer-stage' }));
  };
  const requireSettled = () => {
    if (overflow) throw new Error('LanceDB writer observation limit reached; original staging remains retained.');
    for (const observation of observations) observation.requireSettled();
  };
  const check = async () => {
    requireSettled();
    assertNoSymlinkPath(parent, dir, { allowMissing: true });
    assertPersistenceDirectoryIdentity(await fs.lstat(parent, { bigint: true }), parentIdentity);
    requireSettled();
  };
  const resourcesClosed = () => resources.every(resource => resource.closed);
  const closeResources = async () => {
    requireSettled();
    // Tables precede their connection. Do not close the parent after a table
    // rejects or while an original native operation is still unconfirmed.
    for (const resource of resources) {
      try { await resource.close(); }
      catch (error) { observe(error); throw error; }
      requireSettled();
    }
  };
  const close = () => {
    if (flight) return flight;
    flight = (async () => {
      await closeResources();
      if (!transferred && !removed) {
        await check();
        let stat;
        try { stat = await fs.lstat(dir, { bigint: true }); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        requireSettled();
        if (stat) {
          assertPersistenceDirectoryIdentity(stat, identity);
          await check();
          await fs.rm(dir, { recursive: true, force: true });
        }
        removed = true;
      }
      requireSettled();
      return { settled: true, pending: false };
    })().catch(error => { observe(error); throw error; }).finally(() => { flight = null; });
    return flight;
  };
  return Object.freeze({
    dir, observe, close, closeResources, resourcesClosed,
    acquire(resource, kind) {
      const owner = createLanceDbResourceOwner(resource, kind);
      if (kind === 'table') resources.unshift(owner);
      else resources.push(owner);
      return resource;
    },
    get pending() {
      return (!transferred && !removed) || !resourcesClosed() || overflow
        || observations.some(observation => !observation.isSettled());
    },
    async publishTo(target) {
      requireSettled();
      if (!resourcesClosed()) throw new Error('LanceDB staging cannot move before native resources close.');
      await check();
      assertPersistenceDirectoryIdentity(await fs.lstat(dir, { bigint: true }), identity);
      await replaceDir(dir, target, { allowCopyFallback: false });
      transferred = true;
    }
  });
};
