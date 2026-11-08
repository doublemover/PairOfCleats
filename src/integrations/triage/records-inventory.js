import fs from 'node:fs/promises';
import path from 'node:path';
import { iterateFilesystemCandidates } from '../../index/build/discovery/candidates.js';
import { throwIfAborted } from '../../shared/abort.js';
import { describeStorageFailure } from '../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';
import { readTriagePublication, requiresTriagePublicationRead, hasTriagePublicationNamespace,
  captureTriagePublicationInput, TRIAGE_GENERATION_DIRECTORY } from './record-publication.js';

const stamp = stat => ['dev', 'ino', 'mtimeNs', 'ctimeNs'].map(key => String(stat[key]));
const changed = () => Object.assign(new Error('Records inventory changed during admission.'), { code: 'ERR_RECORDS_INVENTORY_CHANGED' });

/** Reuse deterministic bounded discovery; retain only its one final source list
 * in the builder. A receipt exists only after normal iterator/scratch closure. */
export const createRecordsMarkdownInventory = (directory, { signal = null } = {}) => {
  if (typeof directory !== 'string' || !directory) throw new TypeError('Records inventory root required.');
  const root = path.resolve(directory), metrics = {};
  let receipt = null, started = false, currentPublication = null;
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
      const hasPublications = await hasTriagePublicationNamespace(root, { signal });
      const ignoreMatcher = { ignores: relative => hasPublications && relative.split('/')[0] === TRIAGE_GENERATION_DIRECTORY };
      for await (const file of iterateFilesystemCandidates({ root, canonicalRoot, strictTraversal: true, signal, metrics, ignoreMatcher })) {
        throwIfAborted(signal);
        const extension = path.extname(file);
        if (!['.md', '.json'].includes(extension)) continue;
        const stat = await fs.lstat(file);
        // Preserve the previous inventory's regular-file-only selection. Never
        // reinterpret a link as a record source or substitute another link kind.
        if (stat.isSymbolicLink()) { ignoredLinks++; continue; }
        if (!stat.isFile()) throw changed();
        const jsonPath = extension === '.json' ? file : file.slice(0, -3) + '.json';
        if (extension === '.json') {
          // Existing Markdown candidates own legacy discovery and avoid a
          // second full in-memory path/ID set. JSON-only published generations
          // remain discoverable without creating compatibility Markdown files.
          try {
            const presentation = await fs.lstat(file.slice(0, -5) + '.md');
            if (presentation.isFile() && !presentation.isSymbolicLink()) continue;
          }
          catch (error) {
            if (describeStorageFailure(error, { phase: 'record-presentation-inventory' }).code !== 'ENOENT') throw error;
          }
        }
        const published = await requiresTriagePublicationRead(root, jsonPath, { signal, namespacePresent: hasPublications });
        let publication = published ? await readTriagePublication(root, jsonPath, { signal }) : null;
        currentPublication = captureTriagePublicationInput(publication);
        if (currentPublication) {
          const markdownPath = currentPublication.markdownPath;
          publication = null;
          count++; yield markdownPath;
        } else if (extension === '.md') { count++; yield file; }
        currentPublication = null;
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
  return { files: files(), publicationForCurrent(file) {
    return currentPublication?.markdownPath === file ? currentPublication : null;
  }, receipt() {
    if (!receipt) throw new Error('Records inventory has no complete terminal receipt.');
    return receipt;
  } };
};
