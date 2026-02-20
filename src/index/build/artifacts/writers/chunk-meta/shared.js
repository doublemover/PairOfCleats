import { createRowSpillCollector, compareChunkMetaRows } from '../../helpers.js';
import {
  ORDER_BUCKET_MIN,
  ORDER_BUCKET_TARGET,
  ORDER_BUFFER_BYTES,
  ORDER_BUFFER_ROWS
} from './constants.js';

export const resolveOrderBucketSize = (total) => {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(ORDER_BUCKET_MIN, Math.ceil(total / ORDER_BUCKET_TARGET));
};

export const attachCachedLine = (row, line) => {
  if (!row || typeof row !== 'object') return;
  try {
    Object.defineProperty(row, '__jsonl', { value: line, enumerable: false });
  } catch {}
};

export const mapRows = (rows, mapper) => {
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

export const serializeCachedRow = (row) => {
  if (row && typeof row === 'object' && typeof row.__jsonl === 'string') {
    return row.__jsonl;
  }
  return JSON.stringify(row);
};

/**
 * Serialize a row once and memoize its JSONL payload for downstream fanout.
 * @param {object} row
 * @returns {{line:string,lineBytes:number}}
 */
export const serializeAndCacheRow = (row) => {
  const line = serializeCachedRow(row);
  attachCachedLine(row, line);
  return {
    line,
    lineBytes: Buffer.byteLength(line, 'utf8')
  };
};

const getChunkMetaSortKey = (chunk) => ({
  file: chunk?.file || chunk?.metaV2?.file || null,
  chunkUid: chunk?.chunkUid || chunk?.metaV2?.chunkUid || null,
  chunkId: chunk?.chunkId || chunk?.metaV2?.chunkId || chunk?.id || null,
  id: chunk?.id || null,
  start: chunk?.start,
  name: chunk?.name
});

export const compareChunkMetaChunks = (left, right) => (
  compareChunkMetaRows(getChunkMetaSortKey(left), getChunkMetaSortKey(right))
);

export const compareChunkMetaIdOnly = (a, b) => {
  const idA = Number.isFinite(Number(a?.id)) ? Number(a.id) : null;
  const idB = Number.isFinite(Number(b?.id)) ? Number(b.id) : null;
  if (idA != null && idB != null && idA !== idB) return idA - idB;
  if (idA != null && idB == null) return -1;
  if (idA == null && idB != null) return 1;
  return 0;
};

export const createChunkMetaBucketCollector = ({
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

export const resolveChunkMetaMaxBytes = (maxJsonBytes) => {
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

const truncateUtf8ByBytes = (value, maxBytes) => {
  if (typeof value !== 'string') return value;
  if (!Number.isFinite(Number(maxBytes)) || maxBytes <= 0) return '';
  const resolvedMax = Math.floor(Number(maxBytes));
  if (Buffer.byteLength(value, 'utf8') <= resolvedMax) return value;
  if (resolvedMax <= 3) return '.'.repeat(resolvedMax);
  const suffix = '...';
  const keepBytes = resolvedMax - Buffer.byteLength(suffix, 'utf8');
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const next = value.slice(0, mid);
    if (Buffer.byteLength(next, 'utf8') <= keepBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${value.slice(0, low)}${suffix}`;
};

const toFiniteOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const compactChunkMetaEntry = (entry, maxBytes, stats = null) => {
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
  if (fits(trimmed)) return trimmed;

  recordTrimmedField(stats, 'fallback');
  const fallback = {
    id: toFiniteOrNull(trimmed.id),
    start: toFiniteOrNull(trimmed.start),
    end: toFiniteOrNull(trimmed.end),
    startLine: toFiniteOrNull(trimmed.startLine),
    endLine: toFiniteOrNull(trimmed.endLine),
    file: trimmed.file ?? null,
    fileId: toFiniteOrNull(trimmed.fileId),
    ext: trimmed.ext ?? null,
    lang: trimmed.lang ?? null,
    kind: trimmed.kind ?? null,
    name: trimmed.name ?? null,
    chunkUid: trimmed.chunkUid ?? null,
    chunkId: trimmed.chunkId ?? null,
    virtualPath: trimmed.virtualPath ?? null
  };
  if (fits(fallback)) return fallback;

  const textKeys = ['file', 'virtualPath', 'name', 'kind', 'ext', 'lang', 'chunkUid', 'chunkId'];
  const perFieldBudget = Math.max(24, Math.floor((resolvedMax * 0.6) / textKeys.length));
  for (const key of textKeys) {
    if (typeof fallback[key] !== 'string') continue;
    const next = truncateUtf8ByBytes(fallback[key], perFieldBudget);
    if (next !== fallback[key]) recordTrimmedField(stats, key);
    fallback[key] = next;
  }
  if (fits(fallback)) return fallback;

  const dropOrder = textKeys
    .map((key) => [key, Buffer.byteLength(String(fallback[key] || ''), 'utf8')])
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
  for (const key of dropOrder) {
    if (fallback[key] == null) continue;
    fallback[key] = null;
    recordTrimmedField(stats, key);
    if (fits(fallback)) return fallback;
  }

  return {
    id: toFiniteOrNull(entry?.id),
    start: toFiniteOrNull(entry?.start),
    end: toFiniteOrNull(entry?.end)
  };
};
