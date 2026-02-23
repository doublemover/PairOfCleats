import { createOrderingHasher } from '../../../../../shared/order.js';
import { serializeAndCacheRow } from './shared.js';

/**
 * Analyze chunk-meta rows in a single pass with optional row collection and
 * optional JSON-array byte estimation.
 *
 * @param {object} input
 * @param {(start?:number,end?:number,trackStats?:boolean)=>IterableIterator<object>} input.chunkMetaIterator
 * @param {number} input.chunkMetaCount
 * @param {number} input.resolvedMaxJsonBytes
 * @param {(entry:object)=>object} input.projectHotEntry
 * @param {(entry:object)=>object|null} input.projectColdEntry
 * @param {boolean} [input.collectRows=false]
 * @param {boolean} [input.includeJsonArrayBytes=false]
 * @returns {object}
 */
export const analyzeChunkMetaRows = ({
  chunkMetaIterator,
  chunkMetaCount,
  resolvedMaxJsonBytes,
  projectHotEntry,
  projectColdEntry,
  collectRows = false,
  includeJsonArrayBytes = false
}) => {
  let totalJsonBytes = includeJsonArrayBytes ? 2 : 0;
  let totalJsonlBytes = 0;
  let coldJsonlBytes = 0;
  let total = 0;
  let maxRowBytes = 0;
  let ordered = true;
  let firstOutOfOrder = null;
  let lastId = null;
  let firstIdMismatch = null;
  const orderingHasher = createOrderingHasher();
  const hotRows = collectRows ? [] : null;
  const coldRows = collectRows ? [] : null;
  chunkMetaIterator.resetStats?.();
  for (const entry of chunkMetaIterator(0, chunkMetaCount, true)) {
    const hotEntry = projectHotEntry(entry);
    const { line, lineBytes } = serializeAndCacheRow(hotEntry);
    orderingHasher.update(line);
    maxRowBytes = Math.max(maxRowBytes, lineBytes);
    if (resolvedMaxJsonBytes && (lineBytes + 1) > resolvedMaxJsonBytes) {
      throw new Error(`chunk_meta entry exceeds max JSON size (${lineBytes} bytes).`);
    }
    if (includeJsonArrayBytes) {
      totalJsonBytes += lineBytes + (total > 0 ? 1 : 0);
    }
    totalJsonlBytes += lineBytes + 1;
    if (hotRows) hotRows.push(hotEntry);

    const coldEntry = projectColdEntry(entry);
    if (coldEntry) {
      const { lineBytes: coldLineBytes } = serializeAndCacheRow(coldEntry);
      if (resolvedMaxJsonBytes && (coldLineBytes + 1) > resolvedMaxJsonBytes) {
        throw new Error(`chunk_meta_cold entry exceeds max JSON size (${coldLineBytes} bytes).`);
      }
      coldJsonlBytes += coldLineBytes + 1;
      if (coldRows) coldRows.push(coldEntry);
    }

    total += 1;
    const id = Number.isFinite(hotEntry?.id) ? hotEntry.id : null;
    if (id == null || id !== (total - 1)) {
      if (!firstIdMismatch) {
        firstIdMismatch = { index: total - 1, id };
      }
    }
    if (id == null) {
      if (!firstOutOfOrder) firstOutOfOrder = { prevId: lastId, nextId: id };
      ordered = false;
    } else if (Number.isFinite(lastId) && id < lastId) {
      if (!firstOutOfOrder) firstOutOfOrder = { prevId: lastId, nextId: id };
      ordered = false;
    }
    if (id != null) lastId = id;
  }
  const orderingResult = total ? orderingHasher.digest() : null;
  return {
    totalJsonBytes,
    totalJsonlBytes,
    coldJsonlBytes,
    total,
    maxRowBytes,
    ordered,
    firstOutOfOrder,
    firstIdMismatch,
    orderingHash: orderingResult?.hash || null,
    orderingCount: orderingResult?.count || 0,
    hotRows,
    coldRows
  };
};
