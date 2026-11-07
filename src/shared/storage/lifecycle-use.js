import fs from 'node:fs/promises';
import path from 'node:path';
import { readVerifiedContainedFile } from '../contained-file.js';
import { isPathWithinRoot } from '../file-paths.js';
import { sameStorageFileIdentity, storageFileIdentity } from './inventory.js';
import { describeStorageFailure } from './failure-observation.js';

const key = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const unknown = reason => ({ complete: false, reason, timestamp: null, provenance: 'query-cache-use-unknown', bound: 'lower' });

/** Reuse original physical inventory and the existing query journal owner.
 * Reads are bounded metadata qualification, never another tree inventory or a
 * per-hit write. Cache-shaped source data remains unqualified for deletion. */
export const observeLifecycleUse = async ({ inventory, scope, control, signal }) => {
  const files = new Map(), candidates = new Map(), observations = [], byPath = new Map(); let bytes = 0;
  for (const physical of inventory.physicalFiles) for (const filename of physical.paths) {
    control.check(); files.set(key(filename), physical);
    if (isPathWithinRoot(filename, scope.cacheRoot) && path.basename(filename) === 'queryCache.json') candidates.set(key(filename), filename);
  }
  if (!candidates.size) return { observations, byPath };
  const { observeQueryCacheLastUse } = await import('../../retrieval/query-cache-touches.js');
  const read = async (filename, maximum) => {
    control.check(); const original = files.get(key(filename));
    if (!original || original.nlink !== 1 || original.identity.size > maximum) throw new Error('Original use-observation file is unqualified or exceeds its byte bound.');
    bytes += original.identity.size;
    if (bytes > 32 * 1024 * 1024) control.stopFor('last-use-metadata-byte-budget');
    const result = await readVerifiedContainedFile(scope.cacheRoot, filename, { maxBytes: maximum,
      expectedFileIdentity: { dev: original.identity.dev, ino: original.identity.ino }, signal });
    control.check();
    if (!sameStorageFileIdentity(storageFileIdentity(await fs.lstat(filename, { bigint: true })), original.identity)) control.stopFor('last-use-input-changed');
    control.check(); return { value: JSON.parse(result.buffer.toString('utf8')), sha256: result.hash, identity: original.identity };
  };
  for (const [native, filename] of candidates) {
    control.check(); if (observations.length === 128) control.stopFor('last-use-owner-count-budget');
    const row = { path: filename, purpose: 'query-cache-format-observation', deletionAuthority: false, categoryOwnerQualified: false,
      source: null, journal: null, lastUse: unknown('not-inspected') };
    try {
      const lock = filename + '.lock';
      try { await fs.lstat(lock); control.check(); row.lastUse = unknown('active-or-unknown-query-writer'); observations.push(row); byPath.set(native, row.lastUse); continue; }
      catch (error) { if (control.isStop(error)) throw error; const diagnostic = describeStorageFailure(error, { phase: 'query-use-writer-observation' }); if (diagnostic.code !== 'ENOENT') throw error; }
      const source = await read(filename, 8 * 1024 * 1024), journalFile = filename + '.touches.json';
      const journal = files.has(key(journalFile)) ? await read(journalFile, 256 * 1024) : null;
      if (!journal) {
        try { await fs.lstat(journalFile); control.check(); control.stopFor('last-use-input-changed'); }
        catch (error) { if (control.isStop(error)) throw error; const diagnostic = describeStorageFailure(error, { phase: 'query-use-journal-observation' }); if (diagnostic.code !== 'ENOENT') throw error; }
      }
      control.check();
      if (!sameStorageFileIdentity(storageFileIdentity(await fs.lstat(filename, { bigint: true })), source.identity)
        || journal && !sameStorageFileIdentity(storageFileIdentity(await fs.lstat(journalFile, { bigint: true })), journal.identity)) control.stopFor('last-use-input-changed');
      control.check();
      try { await fs.lstat(lock); control.check(); row.lastUse = unknown('active-or-unknown-query-writer'); }
      catch (error) {
        if (control.isStop(error)) throw error;
        const diagnostic = describeStorageFailure(error, { phase: 'query-use-writer-recheck' });
        if (diagnostic.code !== 'ENOENT') throw error;
        row.lastUse = observeQueryCacheLastUse(source.value, journal?.value ?? null);
      }
      row.source = { sha256: source.sha256, identity: source.identity };
      row.journal = journal ? { path: journalFile, sha256: journal.sha256, identity: journal.identity } : null;
    } catch (error) {
      if (control.isStop(error)) throw error;
      row.lastUse = unknown('unreadable-or-unrecognized-use-input'); row.error = describeStorageFailure(error, { phase: 'lifecycle-query-use' });
    }
    observations.push(row); byPath.set(native, row.lastUse);
  }
  return { observations, byPath };
};
