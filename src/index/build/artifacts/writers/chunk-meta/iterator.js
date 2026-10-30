import { encodeVarint64Into } from '../../../../../shared/artifact-io/varint.js';
import { parseHash64 } from '../../../../../shared/token-id.js';
import { stableOrderWithComparator } from '../../../../../shared/order.js';
import { TRIM_POLICY_VERSION, TRIM_REASONS } from '../../trim-policy.js';
import { createPreparedJsonlRows, readPreparedJsonlRow } from '../../../../../shared/json-stream/prepared-row.js';
import { compactChunkMetaEntry, compareChunkMetaChunks } from './shared.js';

// The schema requires one final base64 string. Encode through one bounded byte
// block rather than retaining a second BigInt array and a JS number per byte.
// Intermediate base64 pieces end on whole three-byte groups, so only the final
// piece carries padding and concatenation is byte-identical to one full buffer.
const packChunkMetaTokenIds = values => {
  const block = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(10, values.length * 10))), pieces = [];
  let used = 0;
  for (const value of values) {
    if (block.length - used < 10) {
      const complete = used - used % 3;
      pieces.push(block.toString('base64', 0, complete));
      block.copy(block, 0, complete, used); used -= complete;
    }
    used += encodeVarint64Into(parseHash64(value), block, used);
  }
  if (used) pieces.push(block.toString('base64', 0, used));
  return pieces.join('');
};

/**
 * Return a stable permutation when chunk_meta rows are out of canonical order.
 * @param {Array<object>} chunks
 * @returns {number[]|null}
 */
export const resolveChunkMetaOrder = (chunks) => {
  if (!Array.isArray(chunks) || chunks.length <= 1) return null;
  let prev = chunks[0];
  for (let i = 1; i < chunks.length; i += 1) {
    const current = chunks[i];
    if (compareChunkMetaChunks(prev, current) > 0) {
      const order = Array.from({ length: chunks.length }, (_, index) => index);
      return stableOrderWithComparator(order, (a, b) => compareChunkMetaChunks(chunks[a], chunks[b]));
    }
    prev = current;
  }
  return null;
};

/**
 * Return an id-ascending permutation for chunk_meta rows when ids are present but unsorted.
 * @param {Array<object>} chunks
 * @returns {number[]|null}
 */
export const resolveChunkMetaOrderById = (chunks) => {
  if (!Array.isArray(chunks) || chunks.length <= 1) return null;
  let prevId = null;
  let ordered = true;
  for (const entry of chunks) {
    const id = Number.isFinite(entry?.id) ? entry.id : null;
    if (id == null) return null;
    if (prevId != null && id < prevId) {
      ordered = false;
      break;
    }
    prevId = id;
  }
  if (ordered) return null;
  const order = Array.from({ length: chunks.length }, (_, index) => index);
  return stableOrderWithComparator(order, (a, b) => {
    const idA = Number(chunks[a]?.id);
    const idB = Number(chunks[b]?.id);
    if (Number.isFinite(idA) && Number.isFinite(idB) && idA !== idB) return idA - idB;
    if (Number.isFinite(idA) && !Number.isFinite(idB)) return -1;
    if (!Number.isFinite(idA) && Number.isFinite(idB)) return 1;
    return compareChunkMetaChunks(chunks[a], chunks[b]);
  });
};

/**
 * Create a reusable chunk_meta iterator that can optionally emit trimming stats.
 * @param {{chunks:Array<object>,fileIdByPath:Map<string,number>,resolvedTokenMode:string,tokenSampleSize:number,maxJsonBytes:number,order?:number[]|null}} input
 * @returns {(start?:number,end?:number,trackStats?:boolean)=>IterableIterator<object>}
 */
export const createChunkMetaIterator = ({
  chunks,
  fileIdByPath,
  resolvedTokenMode,
  tokenSampleSize,
  maxJsonBytes,
  order = null,
  preparedRowsOptions = undefined,
  prepareRows = false
}) => {
  const createStats = () => ({
    trimPolicyVersion: TRIM_POLICY_VERSION,
    trimmedMetaV2: 0,
    trimmedEntries: 0,
    trimmedSamples: [],
    trimmedFields: {},
    trimReasonCounts: {}
  });
  const stats = createStats();
  const preparedRows = createPreparedJsonlRows(preparedRowsOptions);
  let preparationEnabled = prepareRows;
  const preparedByIndex = new Map();
  const sampleLimit = 5;
  const recordTrimSample = (target, entry) => {
    if (target.trimmedSamples.length >= sampleLimit) return;
    target.trimmedSamples.push({
      chunkId: entry.chunkId || entry.id || null,
      file: entry.file || null
    });
  };
  const mergeStats = rowStats => {
    stats.trimmedEntries += rowStats.trimmedEntries;
    stats.trimmedMetaV2 += rowStats.trimmedMetaV2;
    for (const entry of rowStats.trimmedSamples) if (stats.trimmedSamples.length < sampleLimit) stats.trimmedSamples.push(entry);
    for (const field of ['trimmedFields', 'trimReasonCounts']) {
      for (const [key, count] of Object.entries(rowStats[field])) stats[field][key] = (stats[field][key] || 0) + count;
    }
  };
  const scrubDocmetaTooling = (docmeta) => {
    if (!docmeta || typeof docmeta !== 'object') return docmeta;
    const tooling = docmeta.tooling;
    if (!tooling || typeof tooling !== 'object') return docmeta;
    if (!Array.isArray(tooling.sources)) return docmeta;
    const nextSources = tooling.sources.map(({ collectedAt, ...rest }) => rest);
    return {
      ...docmeta,
      tooling: {
        ...tooling,
        sources: nextSources
      }
    };
  };
  const chunkMetaIterator = function* iterator(start = 0, end = chunks.length, trackStats = false) {
    const source = Array.isArray(order) ? order : null;
    const sourceLength = source ? source.length : chunks.length;
    const resolvedEnd = Math.min(end, sourceLength);
    for (let i = start; i < resolvedEnd; i += 1) {
      const index = source ? source[i] : i;
      const prepared = preparedByIndex.get(index);
      if (prepared) {
        if (trackStats) mergeStats(prepared.stats);
        yield prepared.row;
        continue;
      }
      const c = chunks[index];
      const authors = Array.isArray(c.chunk_authors)
        ? c.chunk_authors
        : (Array.isArray(c.chunkAuthors) ? c.chunkAuthors : null);
      const docmeta = scrubDocmetaTooling(c.docmeta);
      const entry = {
        id: c.id,
        chunkId: c.chunkId || null,
        file: c.file || null,
        fileId: fileIdByPath.get(c.file) ?? null,
        ext: c.ext || null,
        lang: c.lang || null,
        containerLanguageId: c.containerLanguageId || null,
        fileHash: c.fileHash || null,
        fileHashAlgo: c.fileHashAlgo || null,
        ...(c.recordSource ? { recordSource: c.recordSource, displayPath: c.recordSource.displayPath } : {}),
        fileSize: Number.isFinite(c.fileSize) ? c.fileSize : null,
        chunkUid: c.chunkUid || c.metaV2?.chunkUid || null,
        virtualPath: c.virtualPath || c.metaV2?.virtualPath || c.segment?.virtualPath || null,
        start: c.start,
        end: c.end,
        startLine: c.startLine,
        endLine: c.endLine,
        kind: c.kind,
        name: c.name,
        weight: c.weight,
        headline: c.headline,
        phraseTokens: c.phraseTokens ?? null,
        phraseTokensCasePreserved: c.phraseTokensCasePreserved === true,
        preContext: c.preContext,
        postContext: c.postContext,
        segment: c.segment || null,
        codeRelations: c.codeRelations,
        docmeta,
        metaV2: c.metaV2,
        stats: c.stats,
        complexity: c.complexity,
        lint: c.lint,
        chunk_authors: authors,
        chunkAuthors: authors
      };
      if (resolvedTokenMode !== 'none') {
        const rawTokens = c.tokens, rawNgrams = c.ngrams;
        const tokens = Array.isArray(rawTokens) ? rawTokens : [];
        const ngrams = Array.isArray(rawNgrams) ? rawNgrams : null;
        const tokenOut = resolvedTokenMode === 'sample'
          ? tokens.slice(0, tokenSampleSize)
          : tokens;
        const ngramOut = resolvedTokenMode === 'sample' && Array.isArray(ngrams)
          ? ngrams.slice(0, tokenSampleSize)
          : ngrams;
        entry.tokens = tokenOut;
        entry.ngrams = ngramOut;
        const rawTokenIds = c.tokenIds;
        const tokenIds = Array.isArray(rawTokenIds) ? rawTokenIds : null;
        if (tokenIds && tokenIds.length) {
          const packInput = resolvedTokenMode === 'sample'
            ? tokenIds.slice(0, tokenSampleSize)
            : tokenIds;
          entry.token_ids_packed = packChunkMetaTokenIds(packInput);
          entry.token_ids_count = packInput.length;
        } else if (typeof c.token_ids_packed === 'string' && Number.isFinite(Number(c.token_ids_count))) {
          const packedCount = Math.max(0, Math.floor(Number(c.token_ids_count)));
          if (resolvedTokenMode !== 'sample' || packedCount <= tokenSampleSize) {
            entry.token_ids_packed = c.token_ids_packed;
            entry.token_ids_count = packedCount;
          }
        }
      }
      const hadMetaV2 = !!entry.metaV2;
      const rowStats = createStats();
      const compacted = compactChunkMetaEntry(entry, maxJsonBytes, rowStats, preparationEnabled ? preparedRows : null);
      if (rowStats.trimReasonCounts[TRIM_REASONS.rowOversize]) {
        rowStats.trimmedEntries += 1;
      }
      if (hadMetaV2 && !compacted.metaV2) {
        rowStats.trimmedMetaV2 += 1;
        recordTrimSample(rowStats, entry);
      }
      if (readPreparedJsonlRow(compacted)) preparedByIndex.set(index, { row: compacted, stats: rowStats });
      if (trackStats) mergeStats(rowStats);
      yield compacted;
    }
  };
  chunkMetaIterator.stats = stats;
  chunkMetaIterator.enablePreparedRows = () => { preparationEnabled = true; };
  // This invocation snapshots only rows admitted by the bounded private owner.
  // Exhaustion reprojects ordinary rows; it never drops input or grows a cache.
  Object.defineProperty(chunkMetaIterator, 'preparedStats', { get: () => ({
    retainedRows: preparedRows.retainedRows, retainedBytes: preparedRows.retainedBytes
  }) });
  chunkMetaIterator.resetStats = () => {
    stats.trimmedMetaV2 = 0;
    stats.trimmedEntries = 0;
    stats.trimmedSamples.length = 0;
    stats.trimmedFields = {};
    stats.trimReasonCounts = {};
  };
  return chunkMetaIterator;
};

/**
 * Convert row-wise chunk_meta objects into a columnar payload.
 * @param {Iterable<object>} rows
 * @returns {{format:'columnar',columns:Array<string>,length:number,arrays:Record<string,Array<any>>}}
 */
export const buildColumnarChunkMetaFromRows = (rows) => {
  const arrays = new Map();
  const keys = [];
  let index = 0;
  for (const entry of rows || []) {
    if (!entry || typeof entry !== 'object') continue;
    for (const key of Object.keys(entry)) {
      if (!arrays.has(key)) {
        arrays.set(key, new Array(index).fill(null));
        keys.push(key);
      }
    }
    for (const key of keys) {
      const column = arrays.get(key);
      column.push(Object.prototype.hasOwnProperty.call(entry, key) ? entry[key] : null);
    }
    index += 1;
  }
  const outArrays = {};
  for (const key of keys) {
    outArrays[key] = arrays.get(key);
  }
  return {
    format: 'columnar',
    columns: keys,
    length: index,
    arrays: outArrays
  };
};

/**
 * Convert iterator output to columnar form without intermediate row arrays.
 * @param {(start?:number,end?:number,trackStats?:boolean)=>IterableIterator<object>} chunkMetaIterator
 * @param {number} chunkMetaCount
 * @returns {{format:'columnar',columns:Array<string>,length:number,arrays:Record<string,Array<any>>}}
 */
export const buildColumnarChunkMeta = (chunkMetaIterator, chunkMetaCount) => {
  return buildColumnarChunkMetaFromRows(chunkMetaIterator(0, chunkMetaCount, false));
};
