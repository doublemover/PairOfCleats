import path from 'node:path';
import { readVerifiedContainedFile, assertNoSymlinkPath } from './contained-file.js';
import { inventoryBackendPayload } from './artifact-io/backend-payload-inventory.js';
import { stableStringify } from './stable-json.js';
import { sameTantivySource, tantivySourceKey } from './tantivy-source.js';
import { TANTIVY_SCHEMA_VERSION, resolveTantivyPaths } from './tantivy.js';
import { observeStorageResource } from './storage/failure-observation.js';

export const TANTIVY_RECEIPT_MAX_BYTES = 1024 * 1024;
const validPublication = value => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);

/** Receipts select one immutable payload. Invalid or legacy receipts never
 * authorize a mutable directory or fall back to an earlier .bak pointer. */
export const readTantivyReceipt = async ({ indexDir, mode, config, source, signal = null }) => {
  const paths = resolveTantivyPaths(indexDir, mode, config);
  const unavailable = reason => ({ ...paths, dir: null, meta: null, available: false, reason });
  let meta;
  try {
    const { buffer } = await readVerifiedContainedFile(paths.dir, paths.metaPath,
      { maxBytes: TANTIVY_RECEIPT_MAX_BYTES, signal });
    meta = JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    observeStorageResource(error, { phase: 'tantivy-receipt-read' }).requireSettled();
    if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') throw error;
    return unavailable('missing-or-incompatible-metadata');
  }
  if (!meta || meta.schemaVersion !== TANTIVY_SCHEMA_VERSION || meta.mode !== mode
    || !['chunkCount', 'docCount', 'vocabCount'].every(key => Number.isSafeInteger(meta[key]) && meta[key] >= 0)
    || !validPublication(meta.publicationId) || !meta.inventory || meta.inventory.version !== 1) {
    return unavailable('missing-or-incompatible-metadata');
  }
  if (!source || !sameTantivySource(source, meta.source) || meta.sourceKey !== tantivySourceKey(source)
    || !['chunkCount', 'docCount', 'vocabCount'].every(key => meta[key] === source[key])) return unavailable('source-identity-mismatch');
  const dir = path.join(paths.dir, 'generations', meta.publicationId);
  try {
    assertNoSymlinkPath(paths.dir, dir);
    const inventory = await inventoryBackendPayload({ dir, signal });
    if (!inventory || !inventory.entries.some(row => row.kind === 'file')
      || stableStringify(inventory) !== stableStringify(meta.inventory)) return unavailable('payload-identity-mismatch');
  } catch (error) {
    observeStorageResource(error, { phase: 'tantivy-payload-admission' }).requireSettled();
    if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') throw error;
    return unavailable('payload-identity-mismatch');
  }
  return { ...paths, dir, meta, available: true, reason: null };
};
