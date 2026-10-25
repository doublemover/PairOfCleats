import fs from 'node:fs/promises';
import path from 'node:path';
import { iterateFilesystemCandidates } from '../../index/build/discovery/candidates.js';
import { throwIfAborted } from '../../shared/abort.js';
import { describeStorageFailure } from '../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';

const stamp = stat => ['dev', 'ino', 'mtimeNs', 'ctimeNs'].map(key => String(stat[key]));
const changed = () => Object.assign(new Error('Records inventory changed during admission.'), { code: 'ERR_RECORDS_INVENTORY_CHANGED' });

/** Reuse deterministic bounded discovery; retain only its one final source list
 * in the builder. A receipt exists only after normal iterator/scratch closure. */
export const createRecordsMarkdownInventory = (directory, { signal = null } = {}) => {
  if (typeof directory !== 'string' || !directory) throw new TypeError('Records inventory root required.');
  const root = path.resolve(directory), metrics = {};
  let receipt = null, started = false;
  const files = async function* () {
    if (started) throw new Error('Records inventory cannot be consumed twice.');
    started = true;
    let count = 0, ignoredLinks = 0;
    try {
      throwIfAborted(signal);
      let before;
      try { before = await fs.lstat(root, { bigint: true }); }
      catch (error) {
        if (describeStorageFailure(error, { phase: 'records-inventory-root' }).code !== 'ENOENT') throw error;
        receipt = Object.freeze({ schemaVersion: 1, root, complete: true, outcome: 'optional-missing', files: 0,
          directories: 0, ignoredLinks: 0 }); return;
      }
      if (before.isSymbolicLink() || !before.isDirectory()) throw changed();
      const canonicalRoot = await fs.realpath(root);
      for await (const file of iterateFilesystemCandidates({ root, canonicalRoot, strictTraversal: true, signal, metrics })) {
        throwIfAborted(signal);
        if (!file.endsWith('.md')) continue;
        const stat = await fs.lstat(file);
        // Preserve the previous inventory's regular-file-only selection. Never
        // reinterpret a link as a record source or substitute another link kind.
        if (stat.isSymbolicLink()) { ignoredLinks++; continue; }
        if (!stat.isFile()) throw changed();
        count++; yield file;
      }
      throwIfAborted(signal);
      const after = await fs.lstat(root, { bigint: true });
      if (after.isSymbolicLink() || !after.isDirectory() || stamp(before).some((value, index) => value !== stamp(after)[index])) throw changed();
      receipt = Object.freeze({ schemaVersion: 1, root, complete: true, outcome: 'complete', files: count,
        directories: metrics.directoriesEnumerated || 0, ignoredLinks,
        sortRowsHighWater: metrics.sortRowsHighWater || 0, sortBytesHighWater: metrics.sortBytesHighWater || 0,
        scratchBytesHighWater: metrics.scratchBytesHighWater || 0 });
    } catch (error) {
      throw addStorageFailureContext(error, { recordsInventory: Object.freeze({ schemaVersion: 1, root,
        complete: false, outcome: 'failed', admittedFiles: count, directories: metrics.directoriesEnumerated || 0 }) });
    }
  };
  return { files: files(), receipt() {
    if (!receipt) throw new Error('Records inventory has no complete terminal receipt.');
    return receipt;
  } };
};
