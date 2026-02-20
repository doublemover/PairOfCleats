import { encodeVarint64List } from '../../../../../shared/artifact-io/varint.js';
import { parseHash64 } from '../../../../../shared/token-id.js';
import { stableOrderWithComparator } from '../../../../../shared/order.js';
import { compactChunkMetaEntry, compareChunkMetaChunks } from './shared.js';

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
  order = null
}) => {
  const stats = {
    trimmedMetaV2: 0,
    trimmedEntries: 0,
    trimmedSamples: [],
    trimmedFields: {}
  };
  const sampleLimit = 5;
  const recordTrimSample = (entry) => {
    if (stats.trimmedSamples.length >= sampleLimit) return;
    stats.trimmedSamples.push({
      chunkId: entry.chunkId || entry.id || null,
      file: entry.file || null
    });
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
        const tokens = Array.isArray(c.tokens) ? c.tokens : [];
        const ngrams = Array.isArray(c.ngrams) ? c.ngrams : null;
        const tokenOut = resolvedTokenMode === 'sample'
          ? tokens.slice(0, tokenSampleSize)
          : tokens;
        const ngramOut = resolvedTokenMode === 'sample' && Array.isArray(ngrams)
          ? ngrams.slice(0, tokenSampleSize)
          : ngrams;
        entry.tokens = tokenOut;
        entry.ngrams = ngramOut;
        const tokenIds = Array.isArray(c.tokenIds) ? c.tokenIds : null;
        if (tokenIds && tokenIds.length) {
          const packInput = resolvedTokenMode === 'sample'
            ? tokenIds.slice(0, tokenSampleSize)
            : tokenIds;
          const packed = encodeVarint64List(packInput.map((value) => parseHash64(value)));
          entry.token_ids_packed = packed.toString('base64');
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
      const compacted = compactChunkMetaEntry(entry, maxJsonBytes, trackStats ? stats : null);
      if (trackStats && compacted !== entry) {
        stats.trimmedEntries += 1;
      }
      if (trackStats && hadMetaV2 && !compacted.metaV2) {
        stats.trimmedMetaV2 += 1;
        recordTrimSample(entry);
      }
      yield compacted;
    }
  };
  chunkMetaIterator.stats = stats;
  chunkMetaIterator.resetStats = () => {
    stats.trimmedMetaV2 = 0;
    stats.trimmedEntries = 0;
    stats.trimmedSamples.length = 0;
    stats.trimmedFields = {};
  };
  return chunkMetaIterator;
};

/**
 * Convert row-wise chunk_meta objects into a columnar payload.
 * @param {Array<object>} rows
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
 * Materialize and convert iterator output to columnar form.
 * @param {(start?:number,end?:number,trackStats?:boolean)=>IterableIterator<object>} chunkMetaIterator
 * @param {number} chunkMetaCount
 * @returns {{format:'columnar',columns:Array<string>,length:number,arrays:Record<string,Array<any>>}}
 */
export const buildColumnarChunkMeta = (chunkMetaIterator, chunkMetaCount) => {
  const rows = [];
  for (const entry of chunkMetaIterator(0, chunkMetaCount, false)) {
    rows.push(entry);
  }
  return buildColumnarChunkMetaFromRows(rows);
};
