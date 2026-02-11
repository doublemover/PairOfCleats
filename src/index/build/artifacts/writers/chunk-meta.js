import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../../../shared/progress.js';
import { MAX_JSON_BYTES } from '../../../../shared/artifact-io.js';
import { encodeVarint64List } from '../../../../shared/artifact-io/varint.js';
import { encodeBinaryRowFrames } from '../../../../shared/artifact-io/binary-columnar.js';
import { parseHash64 } from '../../../../shared/token-id.js';
import { ensureDiskSpace, formatBytes } from '../../../../shared/disk-space.js';
import { createOrderingHasher, stableOrderWithComparator } from '../../../../shared/order.js';
import {
  extractChunkMetaColdFields,
  stripChunkMetaColdFields
} from '../../../../shared/chunk-meta-cold.js';
import {
  replaceFile,
  writeJsonLinesFile,
  writeJsonLinesFileAsync,
  writeJsonLinesSharded,
  writeJsonLinesShardedAsync,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';
import { fromPosix } from '../../../../shared/files.js';
import { mergeSortedRuns } from '../../../../shared/merge.js';
import {
  compareChunkMetaRows,
  createOffsetsMeta,
  createRowSpillCollector,
  recordArtifactTelemetry
} from '../helpers.js';
import { applyByteBudget } from '../../byte-budget.js';
import {
  buildJsonlVariantPaths,
  buildShardedPartEntries,
  removeArtifacts,
  resolveJsonlExtension,
  writeShardedJsonlMeta
} from './_common.js';

const ORDER_BUCKET_TARGET = 64;
const ORDER_BUCKET_MIN = 5000;
const ORDER_BUFFER_BYTES = 4 * 1024 * 1024;
const ORDER_BUFFER_ROWS = 5000;

const resolveOrderBucketSize = (total) => {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(ORDER_BUCKET_MIN, Math.ceil(total / ORDER_BUCKET_TARGET));
};

const attachCachedLine = (row, line) => {
  if (!row || typeof row !== 'object') return;
  try {
    Object.defineProperty(row, '__jsonl', { value: line, enumerable: false });
  } catch {}
};

const mapRows = (rows, mapper) => {
  if (rows && typeof rows[Symbol.asyncIterator] === 'function') {
    return (async function* mappedRowsAsync() {
      for await (const row of rows) {
        const next = mapper(row);
        if (next) yield next;
      }
    })();
  }
  return (function* mappedRowsSync() {
    for (const row of rows || []) {
      const next = mapper(row);
      if (next) yield next;
    }
  })();
};

const serializeCachedRow = (row) => {
  if (row && typeof row === 'object' && typeof row.__jsonl === 'string') {
    return row.__jsonl;
  }
  return JSON.stringify(row);
};

const createChunkMetaBucketCollector = ({
  outDir,
  maxJsonBytes,
  chunkMetaCount
}) => {
  const bucketSize = resolveOrderBucketSize(chunkMetaCount);
  const buckets = new Map();
  const resolveBucketKey = (id) => {
    if (!Number.isFinite(id)) return 0;
    if (!bucketSize) return 0;
    return Math.max(0, Math.floor(id / bucketSize));
  };
  const getCollector = (key) => {
    if (buckets.has(key)) return buckets.get(key);
    const collector = createRowSpillCollector({
      outDir,
      runPrefix: `chunk_meta.bucket-${String(key).padStart(4, '0')}`,
      compare: compareChunkMetaIdOnly,
      maxBufferBytes: ORDER_BUFFER_BYTES,
      maxBufferRows: ORDER_BUFFER_ROWS,
      maxJsonBytes,
      serialize: serializeCachedRow
    });
    buckets.set(key, collector);
    return collector;
  };
  const append = async (row, { line, lineBytes } = {}) => {
    const id = Number.isFinite(row?.id) ? row.id : null;
    const key = resolveBucketKey(id);
    if (line) attachCachedLine(row, line);
    await getCollector(key).append(row, { line, lineBytes });
  };
  const finalize = async () => {
    const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
    const results = [];
    for (const key of keys) {
      results.push({ key, result: await buckets.get(key).finalize() });
    }
    return {
      bucketSize,
      buckets: results,
      cleanup: async () => {
        for (const { result } of results) {
          if (result?.cleanup) await result.cleanup();
        }
      }
    };
  };
  return { append, finalize, bucketSize };
};

const resolveChunkMetaMaxBytes = (maxJsonBytes) => {
  const parsed = Number(maxJsonBytes);
  if (!Number.isFinite(parsed) || parsed <= 0) return maxJsonBytes;
  return Math.floor(parsed);
};

const recordTrimmedField = (stats, field) => {
  if (!stats || !field) return;
  if (!stats.trimmedFields) stats.trimmedFields = {};
  stats.trimmedFields[field] = (stats.trimmedFields[field] || 0) + 1;
};

const recordTrimmedFields = (stats, fields) => {
  if (!stats || !fields) return;
  for (const field of fields) {
    recordTrimmedField(stats, field);
  }
};

const compactChunkMetaEntry = (entry, maxBytes, stats = null) => {
  const resolvedMax = Number.isFinite(Number(maxBytes)) ? Math.floor(Number(maxBytes)) : 0;
  if (!resolvedMax) return entry;
  const fits = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8') + 1 <= resolvedMax;
  if (fits(entry)) return entry;
  const trimmed = { ...entry };
  const tokenFields = [];
  if ('tokens' in trimmed) {
    delete trimmed.tokens;
    tokenFields.push('tokens');
  }
  if ('token_ids_packed' in trimmed) {
    delete trimmed.token_ids_packed;
    tokenFields.push('token_ids_packed');
  }
  if ('token_ids_count' in trimmed) {
    delete trimmed.token_ids_count;
    tokenFields.push('token_ids_count');
  }
  if ('ngrams' in trimmed) {
    delete trimmed.ngrams;
    tokenFields.push('ngrams');
  }
  recordTrimmedFields(stats, tokenFields);
  if (fits(trimmed)) return trimmed;
  const contextFields = [];
  if ('preContext' in trimmed) {
    delete trimmed.preContext;
    contextFields.push('preContext');
  }
  if ('postContext' in trimmed) {
    delete trimmed.postContext;
    contextFields.push('postContext');
  }
  if ('headline' in trimmed) {
    delete trimmed.headline;
    contextFields.push('headline');
  }
  if ('segment' in trimmed) {
    delete trimmed.segment;
    contextFields.push('segment');
  }
  recordTrimmedFields(stats, contextFields);
  if (fits(trimmed)) return trimmed;
  const dropFields = [
    'docmeta',
    'metaV2',
    'stats',
    'complexity',
    'lint',
    'codeRelations',
    'chunk_authors',
    'chunkAuthors',
    'weight'
  ];
  const droppedFields = [];
  for (const field of dropFields) {
    if (field in trimmed) {
      delete trimmed[field];
      droppedFields.push(field);
    }
  }
  recordTrimmedFields(stats, droppedFields);
  return trimmed;
};

const getChunkMetaSortKey = (chunk) => ({
  file: chunk?.file || chunk?.metaV2?.file || null,
  chunkUid: chunk?.chunkUid || chunk?.metaV2?.chunkUid || null,
  chunkId: chunk?.chunkId || chunk?.metaV2?.chunkId || chunk?.id || null,
  id: chunk?.id || null,
  start: chunk?.start,
  name: chunk?.name
});

const compareChunkMetaChunks = (left, right) => (
  compareChunkMetaRows(getChunkMetaSortKey(left), getChunkMetaSortKey(right))
);

const compareChunkMetaIdOnly = (a, b) => {
  const idA = Number.isFinite(Number(a?.id)) ? Number(a.id) : null;
  const idB = Number.isFinite(Number(b?.id)) ? Number(b.id) : null;
  if (idA != null && idB != null && idA !== idB) return idA - idB;
  if (idA != null && idB == null) return -1;
  if (idA == null && idB != null) return 1;
  return 0;
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

const buildColumnarChunkMeta = (chunkMetaIterator, chunkMetaCount) => {
  const arrays = new Map();
  const keys = [];
  let index = 0;
  for (const entry of chunkMetaIterator(0, chunkMetaCount, false)) {
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
 * Decide chunk_meta artifact mode/sharding based on estimated row size and limits.
 * @param {{chunks:Array<object>,chunkMetaIterator:function,artifactMode:string,chunkMetaFormatConfig?:string|null,chunkMetaStreaming?:boolean,chunkMetaBinaryColumnar?:boolean,chunkMetaJsonlThreshold:number,chunkMetaShardSize:number,maxJsonBytes?:number}} input
 * @returns {object}
 */
export const resolveChunkMetaPlan = ({
  chunks,
  chunkMetaIterator,
  artifactMode,
  chunkMetaFormatConfig,
  chunkMetaStreaming = false,
  chunkMetaBinaryColumnar = false,
  chunkMetaJsonlThreshold,
  chunkMetaShardSize,
  maxJsonBytes = MAX_JSON_BYTES
}) => {
  const resolvedMaxJsonBytes = resolveChunkMetaMaxBytes(maxJsonBytes);
  const maxJsonBytesSoft = resolvedMaxJsonBytes * 0.9;
  const shardTargetBytes = resolvedMaxJsonBytes * 0.75;
  const chunkMetaCount = chunks.length;
  const chunkMetaFormat = chunkMetaFormatConfig
    || (artifactMode === 'jsonl' ? 'jsonl' : (artifactMode === 'json' ? 'json' : 'auto'));
  let chunkMetaUseColumnar = chunkMetaFormat === 'columnar';
  let chunkMetaUseJsonl = !chunkMetaUseColumnar && (
    chunkMetaFormat === 'jsonl'
      || (chunkMetaFormat === 'auto' && chunkMetaCount >= chunkMetaJsonlThreshold)
  );
  let resolvedShardSize = chunkMetaShardSize;
  let estimatedJsonlBytes = 0;
  let chunkMetaUseShards = chunkMetaUseJsonl
    && resolvedShardSize > 0
    && chunkMetaCount > resolvedShardSize;
  if (chunkMetaCount > 0) {
    const sampleSize = Math.min(chunkMetaCount, 200);
    let sampledBytes = 0;
    let sampled = 0;
    for (const entry of chunkMetaIterator(0, sampleSize, false)) {
      sampledBytes += Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1;
      sampled += 1;
    }
    if (sampled) {
      const avgBytes = sampledBytes / sampled;
      const estimatedBytes = avgBytes * chunkMetaCount;
      estimatedJsonlBytes = estimatedBytes;
      if (estimatedBytes > maxJsonBytesSoft) {
        if (chunkMetaUseColumnar) {
          chunkMetaUseColumnar = false;
        }
        chunkMetaUseJsonl = true;
        const targetShardSize = Math.max(1, Math.floor(shardTargetBytes / avgBytes));
        if (resolvedShardSize > 0) {
          resolvedShardSize = Math.min(resolvedShardSize, targetShardSize);
        } else {
          resolvedShardSize = targetShardSize;
        }
        chunkMetaUseShards = chunkMetaCount > resolvedShardSize;
        const chunkMetaMode = chunkMetaUseShards ? 'jsonl-sharded' : 'jsonl';
        log(
          `Chunk metadata estimate ~${formatBytes(estimatedBytes)}; ` +
          `using ${chunkMetaMode} to stay under ${formatBytes(resolvedMaxJsonBytes)}.`
        );
      }
    }
  }
  return {
    chunkMetaCount,
    chunkMetaFormat,
    chunkMetaStreaming: chunkMetaStreaming === true,
    chunkMetaBinaryColumnar: chunkMetaBinaryColumnar === true,
    chunkMetaEstimatedJsonlBytes: estimatedJsonlBytes,
    chunkMetaUseJsonl,
    chunkMetaUseColumnar,
    chunkMetaUseShards,
    chunkMetaShardSize: resolvedShardSize,
    maxJsonBytes: resolvedMaxJsonBytes
  };
};

/**
 * Queue chunk_meta artifact writes for the resolved format plan.
 * @param {object} input
 * @returns {Promise<void>}
 */
export const enqueueChunkMetaArtifacts = async ({
  outDir,
  mode,
  chunkMetaIterator,
  chunkMetaPlan,
  maxJsonBytes = MAX_JSON_BYTES,
  byteBudget = null,
  compression = null,
  gzipOptions = null,
  enqueueJsonArray,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  stageCheckpoints
}) => {
  const {
    chunkMetaStreaming,
    chunkMetaUseJsonl,
    chunkMetaUseShards,
    chunkMetaUseColumnar,
    chunkMetaBinaryColumnar,
    chunkMetaEstimatedJsonlBytes,
    chunkMetaShardSize,
    chunkMetaCount,
    maxJsonBytes: plannedMaxJsonBytes
  } = chunkMetaPlan;
  const resolvedMaxJsonBytes = resolveChunkMetaMaxBytes(plannedMaxJsonBytes ?? maxJsonBytes);
  const removeArtifact = async (targetPath) => {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
    } catch {}
  };
  let enableHotColdSplit = chunkMetaStreaming !== true;
  const projectHotEntry = (entry) => (
    enableHotColdSplit ? stripChunkMetaColdFields(entry) : entry
  );
  const projectColdEntry = (entry) => (
    enableHotColdSplit ? extractChunkMetaColdFields(entry) : null
  );
  const scanChunkMeta = () => {
    let totalJsonlBytes = 0;
    let coldJsonlBytes = 0;
    let total = 0;
    let maxRowBytes = 0;
    let ordered = true;
    let firstOutOfOrder = null;
    let lastId = null;
    let firstIdMismatch = null;
    const orderingHasher = createOrderingHasher();
    chunkMetaIterator.resetStats?.();
    for (const entry of chunkMetaIterator(0, chunkMetaCount, true)) {
      const hotEntry = projectHotEntry(entry);
      const line = JSON.stringify(hotEntry);
      const lineBytes = Buffer.byteLength(line, 'utf8');
      orderingHasher.update(line);
      maxRowBytes = Math.max(maxRowBytes, lineBytes);
      if (resolvedMaxJsonBytes && (lineBytes + 1) > resolvedMaxJsonBytes) {
        throw new Error(`chunk_meta entry exceeds max JSON size (${lineBytes} bytes).`);
      }
      totalJsonlBytes += lineBytes + 1;
      const coldEntry = projectColdEntry(entry);
      if (coldEntry) {
        const coldLineBytes = Buffer.byteLength(JSON.stringify(coldEntry), 'utf8');
        if (resolvedMaxJsonBytes && (coldLineBytes + 1) > resolvedMaxJsonBytes) {
          throw new Error(`chunk_meta_cold entry exceeds max JSON size (${coldLineBytes} bytes).`);
        }
        coldJsonlBytes += coldLineBytes + 1;
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
      totalJsonlBytes,
      coldJsonlBytes,
      total,
      maxRowBytes,
      ordered,
      firstOutOfOrder,
      firstIdMismatch,
      orderingHash: orderingResult?.hash || null,
      orderingCount: orderingResult?.count || 0
    };
  };
  const measureChunkMeta = () => {
    let totalJsonBytes = 2;
    let totalJsonlBytes = 0;
    let coldJsonlBytes = 0;
    let total = 0;
    let maxRowBytes = 0;
    const orderingHasher = createOrderingHasher();
    chunkMetaIterator.resetStats?.();
    for (const entry of chunkMetaIterator(0, chunkMetaCount, true)) {
      const hotEntry = projectHotEntry(entry);
      const line = JSON.stringify(hotEntry);
      const lineBytes = Buffer.byteLength(line, 'utf8');
      orderingHasher.update(line);
      maxRowBytes = Math.max(maxRowBytes, lineBytes);
      if (resolvedMaxJsonBytes && (lineBytes + 1) > resolvedMaxJsonBytes) {
        throw new Error(`chunk_meta entry exceeds max JSON size (${lineBytes} bytes).`);
      }
      totalJsonBytes += lineBytes + (total > 0 ? 1 : 0);
      totalJsonlBytes += lineBytes + 1;
      const coldEntry = projectColdEntry(entry);
      if (coldEntry) {
        const coldLineBytes = Buffer.byteLength(JSON.stringify(coldEntry), 'utf8');
        if (resolvedMaxJsonBytes && (coldLineBytes + 1) > resolvedMaxJsonBytes) {
          throw new Error(`chunk_meta_cold entry exceeds max JSON size (${coldLineBytes} bytes).`);
        }
        coldJsonlBytes += coldLineBytes + 1;
      }
      total += 1;
    }
    const orderingResult = total ? orderingHasher.digest() : null;
    return {
      totalJsonBytes,
      totalJsonlBytes,
      coldJsonlBytes,
      total,
      maxRowBytes,
      orderingHash: orderingResult?.hash || null,
      orderingCount: orderingResult?.count || 0
    };
  };

  let resolvedUseJsonl = chunkMetaUseJsonl;
  let resolvedUseShards = chunkMetaUseShards;
  let resolvedUseColumnar = chunkMetaUseColumnar;
  let streamingAdaptiveSharding = false;
  let measured = null;
  let collected = null;
  let jsonlScan = null;
  let outOfOrder = false;
  let firstOutOfOrder = null;
  if (chunkMetaStreaming) {
    resolvedUseJsonl = true;
    resolvedUseColumnar = false;
    resolvedUseShards = chunkMetaShardSize > 0 && chunkMetaCount > chunkMetaShardSize;
    if (!resolvedUseShards) {
      // Streaming mode avoids a full pre-scan, so force byte-bounded shard writes.
      // If the output fits in a single part we promote it back to chunk_meta.jsonl.
      if (chunkMetaCount > 0) {
        resolvedUseShards = true;
        streamingAdaptiveSharding = true;
      }
    }
  }
  if (!resolvedUseJsonl) {
    measured = chunkMetaCount
      ? measureChunkMeta()
      : { totalJsonBytes: 2, totalJsonlBytes: 0, total: 0 };
    if (resolvedMaxJsonBytes && measured.totalJsonBytes > resolvedMaxJsonBytes) {
      resolvedUseColumnar = false;
      resolvedUseJsonl = true;
      resolvedUseShards = true;
      log(
        `Chunk metadata measured ~${formatBytes(measured.totalJsonBytes)}; ` +
        `using jsonl-sharded to stay under ${formatBytes(resolvedMaxJsonBytes)}.`
      );
    }
  }

  if (resolvedUseJsonl && !chunkMetaStreaming) {
    jsonlScan = scanChunkMeta();
    outOfOrder = !jsonlScan.ordered;
    firstOutOfOrder = jsonlScan.firstOutOfOrder;
    if (firstOutOfOrder) {
      log(
        `[chunk_meta] out-of-order ids detected (prev=${firstOutOfOrder.prevId ?? 'null'}, ` +
        `next=${firstOutOfOrder.nextId ?? 'null'}).`
      );
    }
    if (jsonlScan.firstIdMismatch) {
      log(
        `[chunk_meta] docId alignment mismatch at index ${jsonlScan.firstIdMismatch.index} ` +
        `(id=${jsonlScan.firstIdMismatch.id ?? 'null'}).`
      );
    }
    if (resolvedMaxJsonBytes && jsonlScan.totalJsonlBytes > resolvedMaxJsonBytes) {
      resolvedUseShards = true;
      if (!chunkMetaUseShards) {
        log(
          `Chunk metadata measured ~${formatBytes(jsonlScan.totalJsonlBytes)}; ` +
          `using jsonl-sharded to stay under ${formatBytes(resolvedMaxJsonBytes)}.`
        );
      }
    }
    if (outOfOrder) {
      if (enableHotColdSplit) {
        enableHotColdSplit = false;
        jsonlScan = scanChunkMeta();
      }
      const collector = createChunkMetaBucketCollector({
        outDir,
        maxJsonBytes: resolvedMaxJsonBytes,
        chunkMetaCount
      });
      for (const entry of chunkMetaIterator(0, chunkMetaCount, false)) {
        const hotEntry = projectHotEntry(entry);
        const line = JSON.stringify(hotEntry);
        const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
        if (resolvedMaxJsonBytes && lineBytes > resolvedMaxJsonBytes) {
          throw new Error(`chunk_meta entry exceeds max JSON size (${lineBytes} bytes).`);
        }
        await collector.append(hotEntry, { line, lineBytes });
      }
      collected = await collector.finalize();
    }
  } else if (resolvedUseJsonl) {
    jsonlScan = {
      totalJsonlBytes: Number.isFinite(chunkMetaEstimatedJsonlBytes)
        ? Math.max(0, Math.floor(chunkMetaEstimatedJsonlBytes))
        : 0,
      coldJsonlBytes: 0,
      total: chunkMetaCount,
      maxRowBytes: 0,
      ordered: true,
      firstOutOfOrder: null,
      firstIdMismatch: null,
      orderingHash: null,
      orderingCount: chunkMetaCount
    };
  }

  if (chunkMetaIterator.stats?.trimmedMetaV2) {
    const samples = chunkMetaIterator.stats.trimmedSamples || [];
    const sampleText = samples.length
      ? ` (sample: ${samples.map((entry) => `${entry.chunkId || 'unknown'}:${entry.file || 'unknown'}`).join(', ')})`
      : '';
    log(
      `[metaV2] trimmed ${chunkMetaIterator.stats.trimmedMetaV2} chunk_meta entries ` +
      `to fit ${formatBytes(resolvedMaxJsonBytes)}${sampleText}`
    );
  }
  const trimmedEntries = chunkMetaIterator.stats?.trimmedEntries || 0;
  const trimmedMetaV2 = chunkMetaIterator.stats?.trimmedMetaV2 || 0;
  const trimmedFields = chunkMetaIterator.stats?.trimmedFields || null;
  const trimmedFieldsPayload = trimmedFields && Object.keys(trimmedFields).length
    ? trimmedFields
    : null;
  if (resolvedUseJsonl && jsonlScan) {
    const budgetInfo = applyByteBudget({
      budget: byteBudget,
      totalBytes: jsonlScan.totalJsonlBytes,
      label: 'chunk_meta',
      stageCheckpoints,
      logger: log
    });
    const orderInfo = {
      ordered: jsonlScan.ordered,
      sortedBy: outOfOrder ? 'id' : 'none',
      firstOutOfOrder: firstOutOfOrder || null,
      firstIdMismatch: jsonlScan.firstIdMismatch || null,
      bucketSize: collected?.bucketSize || null,
      bucketCount: collected?.buckets?.length || null
    };
    recordArtifactTelemetry(stageCheckpoints, {
      stage: 'stage2',
      artifact: 'chunk_meta',
      rows: jsonlScan.total,
      bytes: jsonlScan.totalJsonlBytes,
      maxRowBytes: jsonlScan.maxRowBytes,
      trimmedRows: trimmedEntries,
      droppedRows: 0,
      extra: {
        format: resolvedUseShards ? 'jsonl-sharded' : 'jsonl',
        streaming: chunkMetaStreaming === true,
        adaptiveSharding: streamingAdaptiveSharding,
        hotColdSplit: enableHotColdSplit,
        coldBytes: jsonlScan.coldJsonlBytes || 0,
        trimmedMetaV2,
        trimmedFields: trimmedFieldsPayload,
        order: orderInfo,
        budget: budgetInfo
      }
    });
  } else if (measured) {
    const budgetInfo = applyByteBudget({
      budget: byteBudget,
      totalBytes: measured.totalJsonBytes,
      label: 'chunk_meta',
      stageCheckpoints,
      logger: log
    });
    recordArtifactTelemetry(stageCheckpoints, {
      stage: 'stage2',
      artifact: 'chunk_meta',
      rows: measured.total,
      bytes: measured.totalJsonBytes,
      maxRowBytes: measured.maxRowBytes,
      trimmedRows: trimmedEntries,
      droppedRows: 0,
      extra: {
        format: 'json',
        hotColdSplit: false,
        trimmedMetaV2,
        trimmedFields: trimmedFieldsPayload,
        budget: budgetInfo
      }
    });
  }
  chunkMetaPlan.chunkMetaUseJsonl = resolvedUseJsonl;
  chunkMetaPlan.chunkMetaUseShards = resolvedUseShards;
  chunkMetaPlan.chunkMetaUseColumnar = resolvedUseColumnar;
  const requiredBytes = resolvedUseJsonl
    ? ((jsonlScan?.totalJsonlBytes || 0) + (enableHotColdSplit ? (jsonlScan?.coldJsonlBytes || 0) : 0))
    : (measured?.totalJsonBytes || 0);
  const orderingHash = jsonlScan?.orderingHash || measured?.orderingHash || null;
  const orderingCount = jsonlScan?.orderingCount || measured?.orderingCount || 0;
  await ensureDiskSpace({
    targetPath: outDir,
    requiredBytes,
    label: mode ? `${mode} chunk_meta` : 'chunk_meta'
  });

  const jsonlExtension = resolveJsonlExtension(compression);
  const jsonlName = `chunk_meta.${jsonlExtension}`;
  const jsonlPath = path.join(outDir, jsonlName);
  const offsetsConfig = compression ? null : { suffix: 'offsets.bin' };
  const offsetsPath = offsetsConfig ? `${jsonlPath}.${offsetsConfig.suffix}` : null;
  const coldJsonlName = `chunk_meta_cold.${jsonlExtension}`;
  const coldJsonlPath = path.join(outDir, coldJsonlName);
  const coldOffsetsPath = offsetsConfig ? `${coldJsonlPath}.${offsetsConfig.suffix}` : null;
  const columnarPath = path.join(outDir, 'chunk_meta.columnar.json');
  const binaryDataPath = path.join(outDir, 'chunk_meta.binary-columnar.bin');
  const binaryOffsetsPath = path.join(outDir, 'chunk_meta.binary-columnar.offsets.bin');
  const binaryLengthsPath = path.join(outDir, 'chunk_meta.binary-columnar.lengths.varint');
  const binaryMetaPath = path.join(outDir, 'chunk_meta.binary-columnar.meta.json');
  const removeJsonlVariants = async () => removeArtifacts(
    buildJsonlVariantPaths({ outDir, baseName: 'chunk_meta', includeOffsets: true })
  );
  const removeColdJsonlVariants = async () => removeArtifacts(
    buildJsonlVariantPaths({ outDir, baseName: 'chunk_meta_cold', includeOffsets: true })
  );

  if (resolvedUseJsonl) {
    await removeArtifact(path.join(outDir, 'chunk_meta.json'));
    await removeArtifact(path.join(outDir, 'chunk_meta.json.gz'));
    await removeArtifact(path.join(outDir, 'chunk_meta.json.zst'));
    await removeArtifact(columnarPath);
    if (resolvedUseShards) {
      // When writing sharded JSONL output, ensure any prior unsharded JSONL output is removed.
      await removeJsonlVariants();
      await removeColdJsonlVariants();
    } else {
      // When writing unsharded JSONL output, remove any stale shard artifacts.
      // The loader prefers chunk_meta.meta.json / chunk_meta.parts over chunk_meta.jsonl.
      await removeArtifact(path.join(outDir, 'chunk_meta.meta.json'));
      await removeArtifact(path.join(outDir, 'chunk_meta.parts'));
      await removeArtifact(path.join(outDir, 'chunk_meta_cold.meta.json'));
      await removeArtifact(path.join(outDir, 'chunk_meta_cold.parts'));
    }
  } else {
    await removeJsonlVariants();
    await removeColdJsonlVariants();
    await removeArtifact(path.join(outDir, 'chunk_meta.meta.json'));
    await removeArtifact(path.join(outDir, 'chunk_meta.parts'));
    await removeArtifact(path.join(outDir, 'chunk_meta_cold.meta.json'));
    await removeArtifact(path.join(outDir, 'chunk_meta_cold.parts'));
    if (!resolvedUseColumnar) {
      await removeArtifact(columnarPath);
    }
  }
  if (!chunkMetaBinaryColumnar) {
    await removeArtifact(binaryDataPath);
    await removeArtifact(binaryOffsetsPath);
    await removeArtifact(binaryLengthsPath);
    await removeArtifact(binaryMetaPath);
  }

  if (resolvedUseJsonl) {
    if (resolvedUseShards) {
      log(`[chunk_meta] writing sharded JSONL -> ${path.join(outDir, 'chunk_meta.parts')}`);
    } else {
      log(`[chunk_meta] writing JSONL -> ${jsonlPath}`);
    }
    if (chunkMetaStreaming) {
      log('[chunk_meta] streaming mode enabled (single-pass JSONL writer).');
    }
    if (enableHotColdSplit) {
      log('[chunk_meta] hot/cold split enabled for JSONL artifacts.');
    }
  } else if (resolvedUseColumnar) {
    log(`[chunk_meta] writing columnar -> ${columnarPath}`);
  } else {
    log(`[chunk_meta] writing JSON -> ${path.join(outDir, 'chunk_meta.json')}`);
  }

  if (resolvedUseJsonl) {
    const rows = collected?.rows || null;
    const runs = collected?.runs || null;
    const buckets = collected?.buckets || null;
    const bucketSize = collected?.bucketSize || null;
    const createItemsSource = () => {
      let items = chunkMetaIterator();
      let itemsAsync = false;
      if (buckets) {
        itemsAsync = true;
        items = (async function* bucketIterator() {
          for (const bucket of buckets) {
            const result = bucket?.result;
            if (!result) continue;
            if (result.runs) {
              yield* mergeSortedRuns(result.runs, { compare: compareChunkMetaIdOnly, validateComparator: true });
            } else if (Array.isArray(result.rows)) {
              for (const row of result.rows) yield row;
            }
          }
        })();
      } else if (runs) {
        itemsAsync = true;
        items = mergeSortedRuns(runs, { compare: compareChunkMetaIdOnly, validateComparator: true });
      } else if (rows) {
        items = rows;
      }
      return { items, itemsAsync };
    };
    const createHotItemsSource = () => {
      const source = createItemsSource();
      return {
        ...source,
        items: mapRows(source.items, (entry) => projectHotEntry(entry))
      };
    };
    const createColdItemsSource = () => {
      const source = createItemsSource();
      return {
        ...source,
        items: mapRows(source.items, (entry) => projectColdEntry(entry))
      };
    };
    let collectedCleaned = false;
    const cleanupCollected = async () => {
      if (collectedCleaned) return;
      collectedCleaned = true;
      if (collected?.cleanup) await collected.cleanup();
    };
    if (!enableHotColdSplit) {
      await removeColdJsonlVariants();
      await removeArtifact(path.join(outDir, 'chunk_meta_cold.meta.json'));
      await removeArtifact(path.join(outDir, 'chunk_meta_cold.parts'));
    }
    if (resolvedUseShards) {
      const metaPath = path.join(outDir, 'chunk_meta.meta.json');
      enqueueWrite(
        formatArtifactLabel(metaPath),
        async () => {
          const { items, itemsAsync } = createHotItemsSource();
          const result = itemsAsync
            ? await writeJsonLinesShardedAsync({
              dir: outDir,
              partsDirName: 'chunk_meta.parts',
              partPrefix: 'chunk_meta.part-',
              items,
              maxBytes: resolvedMaxJsonBytes,
              maxItems: chunkMetaShardSize,
              atomic: true,
              compression,
              gzipOptions,
              offsets: offsetsConfig
            })
            : await writeJsonLinesSharded({
              dir: outDir,
              partsDirName: 'chunk_meta.parts',
              partPrefix: 'chunk_meta.part-',
              items,
              maxBytes: resolvedMaxJsonBytes,
              maxItems: chunkMetaShardSize,
              atomic: true,
              compression,
              gzipOptions,
              offsets: offsetsConfig
            });
          const canPromoteFromSinglePart = streamingAdaptiveSharding
            && !enableHotColdSplit
            && result.parts.length === 1
            && (
              !offsetsPath
              || (Array.isArray(result.offsets) && result.offsets.length === 1)
            );
          if (canPromoteFromSinglePart) {
            const relPath = result.parts[0];
            const absPath = path.join(outDir, fromPosix(relPath));
            await replaceFile(absPath, jsonlPath);
            if (offsetsPath && Array.isArray(result.offsets) && result.offsets[0]) {
              const relOffsetPath = result.offsets[0];
              const absOffsetPath = path.join(outDir, fromPosix(relOffsetPath));
              await replaceFile(absOffsetPath, offsetsPath);
            }
            await removeArtifact(path.join(outDir, 'chunk_meta.parts'));
            await removeArtifact(metaPath);
            addPieceFile({
              type: 'chunks',
              name: 'chunk_meta',
              format: 'jsonl',
              count: chunkMetaCount,
              compression: compression || null
            }, jsonlPath);
            if (offsetsPath) {
              addPieceFile({
                type: 'chunks',
                name: 'chunk_meta_offsets',
                format: 'bin',
                count: chunkMetaCount
              }, offsetsPath);
            }
            await cleanupCollected();
            return;
          }
          const parts = buildShardedPartEntries(result);
          const offsetsMeta = createOffsetsMeta({
            suffix: offsetsConfig?.suffix || null,
            parts: result.offsets,
            compression: 'none'
          });
          await writeShardedJsonlMeta({
            metaPath,
            artifact: 'chunk_meta',
            compression,
            result,
            parts,
            extensions: {
              trim: {
                trimmedEntries,
                trimmedMetaV2,
                trimmedFields: trimmedFieldsPayload
              },
              ...(bucketSize ? { orderBuckets: { size: bucketSize, count: buckets.length } } : {}),
              ...(offsetsMeta ? { offsets: offsetsMeta } : {})
            }
          });
          for (let i = 0; i < result.parts.length; i += 1) {
            const relPath = result.parts[i];
            const absPath = path.join(outDir, fromPosix(relPath));
            addPieceFile({
              type: 'chunks',
              name: 'chunk_meta',
              format: 'jsonl',
              count: result.counts[i] || 0,
              compression: compression || null
            }, absPath);
          }
          if (Array.isArray(result.offsets)) {
            for (let i = 0; i < result.offsets.length; i += 1) {
              const relPath = result.offsets[i];
              if (!relPath) continue;
              const absPath = path.join(outDir, fromPosix(relPath));
              addPieceFile({
                type: 'chunks',
                name: 'chunk_meta_offsets',
                format: 'bin',
                count: result.counts[i] || 0
              }, absPath);
            }
          }
          addPieceFile({ type: 'chunks', name: 'chunk_meta_meta', format: 'json' }, metaPath);
          await cleanupCollected();
        }
      );
      if (enableHotColdSplit) {
        const coldMetaPath = path.join(outDir, 'chunk_meta_cold.meta.json');
        enqueueWrite(
          formatArtifactLabel(coldMetaPath),
          async () => {
            const { items, itemsAsync } = createColdItemsSource();
            const result = itemsAsync
              ? await writeJsonLinesShardedAsync({
                dir: outDir,
                partsDirName: 'chunk_meta_cold.parts',
                partPrefix: 'chunk_meta_cold.part-',
                items,
                maxBytes: resolvedMaxJsonBytes,
                maxItems: chunkMetaShardSize,
                atomic: true,
                compression,
                gzipOptions,
                offsets: offsetsConfig
              })
              : await writeJsonLinesSharded({
                dir: outDir,
                partsDirName: 'chunk_meta_cold.parts',
                partPrefix: 'chunk_meta_cold.part-',
                items,
                maxBytes: resolvedMaxJsonBytes,
                maxItems: chunkMetaShardSize,
                atomic: true,
                compression,
                gzipOptions,
                offsets: offsetsConfig
              });
            const parts = buildShardedPartEntries(result);
            const offsetsMeta = createOffsetsMeta({
              suffix: offsetsConfig?.suffix || null,
              parts: result.offsets,
              compression: 'none'
            });
            await writeShardedJsonlMeta({
              metaPath: coldMetaPath,
              artifact: 'chunk_meta_cold',
              compression,
              result,
              parts,
              extensions: {
                ...(offsetsMeta ? { offsets: offsetsMeta } : {})
              }
            });
            for (let i = 0; i < result.parts.length; i += 1) {
              const relPath = result.parts[i];
              const absPath = path.join(outDir, fromPosix(relPath));
              addPieceFile({
                type: 'chunks',
                name: 'chunk_meta_cold',
                format: 'jsonl',
                count: result.counts[i] || 0,
                compression: compression || null
              }, absPath);
            }
            if (Array.isArray(result.offsets)) {
              for (let i = 0; i < result.offsets.length; i += 1) {
                const relPath = result.offsets[i];
                if (!relPath) continue;
                const absPath = path.join(outDir, fromPosix(relPath));
                addPieceFile({
                  type: 'chunks',
                  name: 'chunk_meta_cold_offsets',
                  format: 'bin',
                  count: result.counts[i] || 0
                }, absPath);
              }
            }
            addPieceFile({ type: 'chunks', name: 'chunk_meta_cold_meta', format: 'json' }, coldMetaPath);
            await cleanupCollected();
          }
        );
      }
    } else {
      enqueueWrite(
        formatArtifactLabel(jsonlPath),
        async () => {
          const { items } = createHotItemsSource();
          await writeJsonLinesFileAsync(
            jsonlPath,
            items,
            {
              atomic: true,
              compression,
              gzipOptions,
              offsets: offsetsPath ? { path: offsetsPath, atomic: true } : null,
              maxBytes: resolvedMaxJsonBytes
            }
          );
          await cleanupCollected();
        }
      );
      addPieceFile({
        type: 'chunks',
        name: 'chunk_meta',
        format: 'jsonl',
        count: chunkMetaCount,
        compression: compression || null
      }, jsonlPath);
      if (offsetsPath) {
        addPieceFile({
          type: 'chunks',
          name: 'chunk_meta_offsets',
          format: 'bin',
          count: chunkMetaCount
        }, offsetsPath);
      }
      if (enableHotColdSplit) {
        enqueueWrite(
          formatArtifactLabel(coldJsonlPath),
          async () => {
            const { items } = createColdItemsSource();
            await writeJsonLinesFileAsync(
              coldJsonlPath,
              items,
              {
                atomic: true,
                compression,
                gzipOptions,
                offsets: coldOffsetsPath ? { path: coldOffsetsPath, atomic: true } : null,
                maxBytes: resolvedMaxJsonBytes
              }
            );
            await cleanupCollected();
          }
        );
        addPieceFile({
          type: 'chunks',
          name: 'chunk_meta_cold',
          format: 'jsonl',
          count: chunkMetaCount,
          compression: compression || null
        }, coldJsonlPath);
        if (coldOffsetsPath) {
          addPieceFile({
            type: 'chunks',
            name: 'chunk_meta_cold_offsets',
            format: 'bin',
            count: chunkMetaCount
          }, coldOffsetsPath);
        }
      }
    }
  } else if (resolvedUseColumnar) {
    enqueueWrite(
      formatArtifactLabel(columnarPath),
      async () => {
        await removeArtifact(path.join(outDir, 'chunk_meta.json'));
        await removeArtifact(path.join(outDir, 'chunk_meta.json.gz'));
        await removeArtifact(path.join(outDir, 'chunk_meta.json.zst'));
        const payload = buildColumnarChunkMeta(chunkMetaIterator, chunkMetaCount);
        await writeJsonObjectFile(columnarPath, { fields: payload, atomic: true });
      }
    );
    addPieceFile({
      type: 'chunks',
      name: 'chunk_meta',
      format: 'columnar',
      count: chunkMetaCount
    }, columnarPath);
  } else {
    enqueueJsonArray('chunk_meta', chunkMetaIterator(), {
      piece: { type: 'chunks', name: 'chunk_meta', count: chunkMetaCount }
    });
  }
  if (chunkMetaBinaryColumnar) {
    enqueueWrite(
      formatArtifactLabel(binaryMetaPath),
      async () => {
        const fileTable = [];
        const fileRefByPath = new Map();
        const rows = [];
        for (const entry of chunkMetaIterator(0, chunkMetaCount, false)) {
          const hotEntry = projectHotEntry(entry);
          if (!hotEntry || typeof hotEntry !== 'object') continue;
          const next = { ...hotEntry };
          const file = typeof hotEntry.file === 'string' ? hotEntry.file : null;
          if (file) {
            let fileRef = fileRefByPath.get(file);
            if (!Number.isInteger(fileRef)) {
              fileRef = fileTable.length;
              fileRefByPath.set(file, fileRef);
              fileTable.push(file);
            }
            next.fileRef = fileRef;
            delete next.file;
          }
          rows.push(next);
        }
        if (outOfOrder) rows.sort(compareChunkMetaIdOnly);
        const rowPayloads = rows.map((row) => Buffer.from(JSON.stringify(row), 'utf8'));
        const frames = encodeBinaryRowFrames(rowPayloads);
        await fs.writeFile(binaryDataPath, frames.dataBuffer);
        await fs.writeFile(binaryOffsetsPath, frames.offsetsBuffer);
        await fs.writeFile(binaryLengthsPath, frames.lengthsBuffer);
        await writeJsonObjectFile(binaryMetaPath, {
          fields: {
            format: 'binary-columnar-v1',
            rowEncoding: 'json-rows',
            count: frames.count,
            data: path.posix.basename(binaryDataPath),
            offsets: path.posix.basename(binaryOffsetsPath),
            lengths: path.posix.basename(binaryLengthsPath),
            orderingHash,
            orderingCount
          },
          arrays: {
            fileTable
          },
          atomic: true
        });
      }
    );
    addPieceFile({
      type: 'chunks',
      name: 'chunk_meta_binary_columnar',
      format: 'binary-columnar',
      count: chunkMetaCount
    }, binaryDataPath);
    addPieceFile({
      type: 'chunks',
      name: 'chunk_meta_binary_columnar_offsets',
      format: 'binary',
      count: chunkMetaCount
    }, binaryOffsetsPath);
    addPieceFile({
      type: 'chunks',
      name: 'chunk_meta_binary_columnar_lengths',
      format: 'varint',
      count: chunkMetaCount
    }, binaryLengthsPath);
    addPieceFile({
      type: 'chunks',
      name: 'chunk_meta_binary_columnar_meta',
      format: 'json'
    }, binaryMetaPath);
  }
  return { orderingHash, orderingCount };
};
