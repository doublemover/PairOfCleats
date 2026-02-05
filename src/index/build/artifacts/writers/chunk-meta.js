import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../../../shared/progress.js';
import { MAX_JSON_BYTES } from '../../../../shared/artifact-io.js';
import { ensureDiskSpace } from '../../../../shared/disk-space.js';
import {
  writeJsonLinesFile,
  writeJsonLinesFileAsync,
  writeJsonLinesSharded,
  writeJsonLinesShardedAsync,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';
import { fromPosix } from '../../../../shared/files.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../../contracts/versioning.js';
import {
  compareChunkMetaRows,
  createOffsetsMeta,
  createRowSpillCollector,
  mergeSortedRuns,
  recordArtifactTelemetry
} from '../helpers.js';

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

const formatBytes = (bytes) => {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0B';
  if (value < 1024) return `${Math.round(value)}B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)}GB`;
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

export const resolveChunkMetaOrder = (chunks) => {
  if (!Array.isArray(chunks) || chunks.length <= 1) return null;
  let prev = chunks[0];
  for (let i = 1; i < chunks.length; i += 1) {
    const current = chunks[i];
    if (compareChunkMetaChunks(prev, current) > 0) {
      const order = Array.from({ length: chunks.length }, (_, index) => index);
      order.sort((a, b) => compareChunkMetaChunks(chunks[a], chunks[b]));
      return order;
    }
    prev = current;
  }
  return null;
};

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
  order.sort((a, b) => {
    const idA = Number(chunks[a]?.id);
    const idB = Number(chunks[b]?.id);
    if (Number.isFinite(idA) && Number.isFinite(idB) && idA !== idB) return idA - idB;
    if (Number.isFinite(idA) && !Number.isFinite(idB)) return -1;
    if (!Number.isFinite(idA) && Number.isFinite(idB)) return 1;
    return compareChunkMetaChunks(chunks[a], chunks[b]);
  });
  return order;
};

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

export const resolveChunkMetaPlan = ({
  chunks,
  chunkMetaIterator,
  artifactMode,
  chunkMetaFormatConfig,
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
    chunkMetaUseJsonl,
    chunkMetaUseColumnar,
    chunkMetaUseShards,
    chunkMetaShardSize: resolvedShardSize,
    maxJsonBytes: resolvedMaxJsonBytes
  };
};

export const enqueueChunkMetaArtifacts = async ({
  outDir,
  mode,
  chunkMetaIterator,
  chunkMetaPlan,
  maxJsonBytes = MAX_JSON_BYTES,
  compression = null,
  gzipOptions = null,
  enqueueJsonArray,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  stageCheckpoints
}) => {
  const {
    chunkMetaUseJsonl,
    chunkMetaUseShards,
    chunkMetaUseColumnar,
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
  const scanChunkMeta = () => {
    let totalJsonlBytes = 0;
    let total = 0;
    let maxRowBytes = 0;
    let ordered = true;
    let firstOutOfOrder = null;
    let lastId = null;
    let firstIdMismatch = null;
    chunkMetaIterator.resetStats?.();
    for (const entry of chunkMetaIterator(0, chunkMetaCount, true)) {
      const line = JSON.stringify(entry);
      const lineBytes = Buffer.byteLength(line, 'utf8');
      maxRowBytes = Math.max(maxRowBytes, lineBytes);
      if (resolvedMaxJsonBytes && (lineBytes + 1) > resolvedMaxJsonBytes) {
        throw new Error(`chunk_meta entry exceeds max JSON size (${lineBytes} bytes).`);
      }
      totalJsonlBytes += lineBytes + 1;
      total += 1;
      const id = Number.isFinite(entry?.id) ? entry.id : null;
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
    return { totalJsonlBytes, total, maxRowBytes, ordered, firstOutOfOrder, firstIdMismatch };
  };
  const measureChunkMeta = () => {
    let totalJsonBytes = 2;
    let totalJsonlBytes = 0;
    let total = 0;
    let maxRowBytes = 0;
    chunkMetaIterator.resetStats?.();
    for (const entry of chunkMetaIterator(0, chunkMetaCount, true)) {
      const line = JSON.stringify(entry);
      const lineBytes = Buffer.byteLength(line, 'utf8');
      maxRowBytes = Math.max(maxRowBytes, lineBytes);
      if (resolvedMaxJsonBytes && (lineBytes + 1) > resolvedMaxJsonBytes) {
        throw new Error(`chunk_meta entry exceeds max JSON size (${lineBytes} bytes).`);
      }
      totalJsonBytes += lineBytes + (total > 0 ? 1 : 0);
      totalJsonlBytes += lineBytes + 1;
      total += 1;
    }
    return { totalJsonBytes, totalJsonlBytes, total, maxRowBytes };
  };

  let resolvedUseJsonl = chunkMetaUseJsonl;
  let resolvedUseShards = chunkMetaUseShards;
  let resolvedUseColumnar = chunkMetaUseColumnar;
  let measured = null;
  let collected = null;
  let jsonlScan = null;
  let outOfOrder = false;
  let firstOutOfOrder = null;
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

  if (resolvedUseJsonl) {
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
      const collector = createChunkMetaBucketCollector({
        outDir,
        maxJsonBytes: resolvedMaxJsonBytes,
        chunkMetaCount
      });
      for (const entry of chunkMetaIterator(0, chunkMetaCount, false)) {
        const line = JSON.stringify(entry);
        const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
        if (resolvedMaxJsonBytes && lineBytes > resolvedMaxJsonBytes) {
          throw new Error(`chunk_meta entry exceeds max JSON size (${lineBytes} bytes).`);
        }
        await collector.append(entry, { line, lineBytes });
      }
      collected = await collector.finalize();
    }
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
        trimmedMetaV2,
        trimmedFields: trimmedFieldsPayload,
        order: orderInfo
      }
    });
  } else if (measured) {
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
        trimmedMetaV2,
        trimmedFields: trimmedFieldsPayload
      }
    });
  }
  chunkMetaPlan.chunkMetaUseJsonl = resolvedUseJsonl;
  chunkMetaPlan.chunkMetaUseShards = resolvedUseShards;
  chunkMetaPlan.chunkMetaUseColumnar = resolvedUseColumnar;
  const requiredBytes = resolvedUseJsonl
    ? (jsonlScan?.totalJsonlBytes || 0)
    : (measured?.totalJsonBytes || 0);
  await ensureDiskSpace({
    targetPath: outDir,
    requiredBytes,
    label: mode ? `${mode} chunk_meta` : 'chunk_meta'
  });

  const resolveJsonlExtension = (value) => {
    if (value === 'gzip') return 'jsonl.gz';
    if (value === 'zstd') return 'jsonl.zst';
    return 'jsonl';
  };
  const jsonlExtension = resolveJsonlExtension(compression);
  const jsonlName = `chunk_meta.${jsonlExtension}`;
  const jsonlPath = path.join(outDir, jsonlName);
  const offsetsConfig = compression ? null : { suffix: 'offsets.bin' };
  const offsetsPath = offsetsConfig ? `${jsonlPath}.${offsetsConfig.suffix}` : null;
  const columnarPath = path.join(outDir, 'chunk_meta.columnar.json');
  const removeJsonlVariants = async () => {
    await removeArtifact(path.join(outDir, 'chunk_meta.jsonl'));
    await removeArtifact(path.join(outDir, 'chunk_meta.jsonl.gz'));
    await removeArtifact(path.join(outDir, 'chunk_meta.jsonl.zst'));
    await removeArtifact(path.join(outDir, 'chunk_meta.jsonl.offsets.bin'));
  };

  if (resolvedUseJsonl) {
    await removeArtifact(path.join(outDir, 'chunk_meta.json'));
    await removeArtifact(path.join(outDir, 'chunk_meta.json.gz'));
    await removeArtifact(path.join(outDir, 'chunk_meta.json.zst'));
    await removeArtifact(columnarPath);
    if (resolvedUseShards) {
      // When writing sharded JSONL output, ensure any prior unsharded JSONL output is removed.
      await removeJsonlVariants();
    } else {
      // When writing unsharded JSONL output, remove any stale shard artifacts.
      // The loader prefers chunk_meta.meta.json / chunk_meta.parts over chunk_meta.jsonl.
      await removeArtifact(path.join(outDir, 'chunk_meta.meta.json'));
      await removeArtifact(path.join(outDir, 'chunk_meta.parts'));
    }
  } else {
    await removeJsonlVariants();
    await removeArtifact(path.join(outDir, 'chunk_meta.meta.json'));
    await removeArtifact(path.join(outDir, 'chunk_meta.parts'));
    if (!resolvedUseColumnar) {
      await removeArtifact(columnarPath);
    }
  }

  if (resolvedUseJsonl) {
    const rows = collected?.rows || null;
    const runs = collected?.runs || null;
    const buckets = collected?.buckets || null;
    const bucketSize = collected?.bucketSize || null;
    let items = chunkMetaIterator();
    let itemsAsync = false;
    if (buckets) {
      itemsAsync = true;
      items = (async function* bucketIterator() {
        for (const bucket of buckets) {
          const result = bucket?.result;
          if (!result) continue;
          if (result.runs) {
            yield* mergeSortedRuns(result.runs, { compare: compareChunkMetaIdOnly });
          } else if (Array.isArray(result.rows)) {
            for (const row of result.rows) yield row;
          }
        }
      })();
    } else if (runs) {
      itemsAsync = true;
      items = mergeSortedRuns(runs, { compare: compareChunkMetaIdOnly });
    } else if (rows) {
      items = rows;
    }
    if (resolvedUseShards) {
      const metaPath = path.join(outDir, 'chunk_meta.meta.json');
      enqueueWrite(
        formatArtifactLabel(metaPath),
        async () => {
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
          const parts = result.parts.map((part, index) => ({
            path: part,
            records: result.counts[index] || 0,
            bytes: result.bytes[index] || 0
          }));
          const offsetsMeta = createOffsetsMeta({
            suffix: offsetsConfig?.suffix || null,
            parts: result.offsets,
            compression: 'none'
          });
          await writeJsonObjectFile(metaPath, {
            fields: {
              schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
              artifact: 'chunk_meta',
              format: 'jsonl-sharded',
              generatedAt: new Date().toISOString(),
              compression: compression || 'none',
              totalRecords: result.total,
              totalBytes: result.totalBytes,
              maxPartRecords: result.maxPartRecords,
              maxPartBytes: result.maxPartBytes,
              targetMaxBytes: result.targetMaxBytes,
              extensions: {
                trim: {
                  trimmedEntries,
                  trimmedMetaV2,
                  trimmedFields: trimmedFieldsPayload
                },
                ...(bucketSize ? { orderBuckets: { size: bucketSize, count: buckets.length } } : {}),
                ...(offsetsMeta ? { offsets: offsetsMeta } : {})
              },
              parts
            },
            atomic: true
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
          if (collected?.cleanup) await collected.cleanup();
        }
      );
    } else {
      enqueueWrite(
        formatArtifactLabel(jsonlPath),
        async () => {
          await writeJsonLinesFileAsync(
            jsonlPath,
            items,
            {
              atomic: true,
              compression,
              gzipOptions,
              offsets: offsetsPath ? { path: offsetsPath, atomic: true } : null
            }
          );
          if (collected?.cleanup) await collected.cleanup();
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
};
