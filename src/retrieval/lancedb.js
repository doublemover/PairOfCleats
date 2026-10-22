import fs from 'node:fs';
import { distanceToSimilarity, withAnnScoreSpace } from '../shared/ann-similarity.js';
import { tryImport } from '../shared/optional-deps.js';
import { normalizeLanceDbConfig } from '../shared/lancedb.js';
import { createWarnOnce } from '../shared/logging/warn-once.js';
import { normalizePositiveInt } from '../shared/limits.js';
import {
  candidateSetHas,
  getCandidateSetSize,
  normalizeCandidateSetIds
} from './ann/candidate-set.js';
import { normalizeEmbeddingDims } from './ann/dims.js';
import { createTopKReducer } from './pipeline/topk.js';
import { throwIfAborted } from '../shared/abort.js';
import { setImmediate as yieldImmediate } from 'node:timers/promises';

const CANDIDATE_PUSH_LIMIT = 500;
const CONNECTION_CACHE_TTL_MS = 10 * 60 * 1000;
const CONNECTION_CACHE_MAX_ENTRIES = 8;

let cachedModule = null;
const warnOnce = createWarnOnce();

const loadLanceDb = async () => {
  if (cachedModule) return cachedModule;
  const result = await tryImport('@lancedb/lancedb');
  if (!result.ok) {
    warnOnce('lancedb-missing', '[ann] LanceDB unavailable; falling back to other ANN backends.');
    return null;
  }
  cachedModule = result.mod?.default || result.mod;
  return cachedModule;
};

const connectionCache = new Map();

const closeMaybe = async (resource) => {
  if (!resource) return;
  const close = resource.close || resource.closeSync;
  if (typeof close !== 'function') return;
  try {
    const result = close.call(resource);
    if (result && typeof result.then === 'function') {
      await result;
    }
  } catch {}
};

const closeConnectionEntry = async (entry) => {
  if (!entry || typeof entry !== 'object') return;
  entry.retired = true;
  if (entry.refs > 0) return;
  if (!entry.closing) entry.closing = (async () => {
    for (const table of entry.tables?.values() || []) await closeMaybe(table);
    await closeMaybe(entry.db);
    entry.tables = new Map();
    entry.db = null;
    entry.pending = null;
  })();
  await entry.closing;
};

const touchConnectionEntry = (entry, now = Date.now()) => {
  if (!entry || typeof entry !== 'object') return;
  entry.lastAccessMs = now;
  entry.expiresAtMs = now + CONNECTION_CACHE_TTL_MS;
};

const pruneConnectionCache = async ({ now = Date.now() } = {}) => {
  const staleKeys = [];
  for (const [key, entry] of connectionCache.entries()) {
    if (!entry || typeof entry !== 'object') {
      staleKeys.push(key);
      continue;
    }
    if (entry.pending) continue;
    if (entry.expiresAtMs && entry.expiresAtMs <= now) {
      staleKeys.push(key);
    }
  }
  for (const key of staleKeys) {
    const entry = connectionCache.get(key);
    connectionCache.delete(key);
    await closeConnectionEntry(entry);
  }
  if (connectionCache.size <= CONNECTION_CACHE_MAX_ENTRIES) return;
  const evictable = Array.from(connectionCache.entries())
    .filter(([, entry]) => !entry?.pending)
    .sort((a, b) => (a[1]?.lastAccessMs || 0) - (b[1]?.lastAccessMs || 0));
  let overflow = connectionCache.size - CONNECTION_CACHE_MAX_ENTRIES;
  for (const [key, entry] of evictable) {
    if (overflow <= 0) break;
    connectionCache.delete(key);
    await closeConnectionEntry(entry);
    overflow -= 1;
  }
};

export const clearLanceDbConnectionCache = async () => {
  const entries = Array.from(connectionCache.values());
  connectionCache.clear();
  for (const entry of entries) {
    await closeConnectionEntry(entry);
  }
};

const getConnection = async (dir) => {
  if (!dir) return null;
  const now = Date.now();
  await pruneConnectionCache({ now });
  let entry = connectionCache.get(dir);
  if (!entry) {
    entry = { db: null, tables: new Map(), openingTables: new Map(), refs: 0,
      retired: false, pending: null, lastAccessMs: now, expiresAtMs: now + CONNECTION_CACHE_TTL_MS };
    entry.pending = (async () => {
      const lancedb = await loadLanceDb();
      const connect = lancedb?.connect || lancedb?.default?.connect;
      return connect ? connect(dir) : null;
    })();
    entry.pending.catch(() => {});
    connectionCache.set(dir, entry);
  }
  // Pin before yielding to connect, openTable or cache eviction. Retirement
  // removes lookup ownership; the last query lease owns eventual native close.
  entry.refs++;
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    entry.refs--;
    if (entry.retired) await closeConnectionEntry(entry);
  };
  touchConnectionEntry(entry, now);
  try {
    await pruneConnectionCache({ now });
    entry.db ||= await entry.pending;
    if (!entry.db) throw new Error('LanceDB connection unavailable.');
    entry.pending = null;
    touchConnectionEntry(entry);
    return { entry, release };
  } catch {
    if (connectionCache.get(dir) === entry) connectionCache.delete(dir);
    await closeConnectionEntry(entry);
    await release();
    return null;
  }
};

const getTable = async (dir, tableName) => {
  const lease = await getConnection(dir);
  if (!lease) return null;
  const connection = lease.entry;
  try {
    if (!tableName || typeof connection.db?.openTable !== 'function') {
      await lease.release();
      return null;
    }
    if (!connection.tables.has(tableName)) {
      if (!connection.openingTables.has(tableName)) {
        const opening = Promise.resolve().then(() => connection.db.openTable(tableName)).then(table => {
          connection.tables.set(tableName, table);
          return table;
        }).finally(() => connection.openingTables.delete(tableName));
        connection.openingTables.set(tableName, opening);
      }
      await connection.openingTables.get(tableName);
    }
    return { table: connection.tables.get(tableName), release: lease.release };
  } catch (error) {
    await lease.release();
    throw error;
  }
};

const toArray = async (query) => {
  if (!query) return [];
  if (typeof query.toArray === 'function') return query.toArray();
  if (typeof query.execute === 'function') return query.execute();
  if (typeof query.collect === 'function') return query.collect();
  return [];
};

const readRowId = (row, idColumn) => {
  const value = row?.[idColumn] ?? row?.id ?? row?._id ?? row?.idx;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return null;
};

const readRowScore = (row, metric) => {
  const distanceRaw = row?._distance ?? row?.distance;
  if (distanceRaw != null) {
    return distanceToSimilarity(distanceRaw, metric);
  }
  const scoreRaw = row?.score ?? row?._score ?? row?.sim ?? row?.similarity;
  const score = Number(scoreRaw);
  return Number.isFinite(score) ? score : null;
};

const isSafeIdColumn = (value) => (
  typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
);

export async function rankLanceDb({
  lancedbInfo,
  queryEmbedding,
  topN,
  candidateSet,
  config,
  signal = null
}) {
  throwIfAborted(signal);
  const candidateCount = getCandidateSetSize(candidateSet);
  if (candidateSet != null && candidateCount === 0) return [];
  if (!lancedbInfo?.available) return [];
  const resolvedConfig = normalizeLanceDbConfig(config);
  if (!resolvedConfig.enabled) return [];

  const meta = lancedbInfo.meta || {};
  const tableName = meta.table || resolvedConfig.table;
  const idColumn = meta.idColumn || resolvedConfig.idColumn;
  const embeddingColumn = meta.embeddingColumn || resolvedConfig.embeddingColumn;
  const metric = meta.metric || resolvedConfig.metric;
  const dims = Number.isFinite(Number(meta.dims)) ? Number(meta.dims) : null;
  const normalized = normalizeEmbeddingDims(queryEmbedding, dims);
  if (!normalized.embedding) return [];
  const embeddingArray = normalized.embedding;
  if (normalized.adjusted && normalized.expectedDims) {
    warnOnce(
      'lancedb-query-dims',
      `[ann] LanceDB query dims mismatch (query=${normalized.queryDims}, index=${normalized.expectedDims}); ` +
      'clipping/padding query vector to index dims.'
    );
  }

  const dir = lancedbInfo.dir;
  if (!dir || !fs.existsSync(dir)) return [];

  let tableLease;
  try {
    tableLease = await getTable(dir, tableName);
  } catch (err) {
    throwIfAborted(signal);
    warnOnce(
      'lancedb-table-load',
      `[ann] LanceDB table load failed; falling back to other ANN backends. ${err?.message || err}`
    );
    return [];
  }
  const table = tableLease?.table;
  if (!table || typeof table.search !== 'function') {
    await tableLease?.release();
    throwIfAborted(signal);
    return [];
  }

  try {
    throwIfAborted(signal);
    const limitBase = normalizePositiveInt(topN, 1) || 1;
    const candidateIds = (candidateCount && isSafeIdColumn(idColumn))
      ? normalizeCandidateSetIds(candidateSet)
      : [];

    const createBaseQuery = () => {
      let query = table.search(embeddingArray);
      if (typeof query?.column !== 'function') throw new Error('LanceDB query builder cannot select the declared vector column.');
      query = query.column(embeddingColumn);
      if (typeof query?.metricType === 'function') {
        query = query.metricType(metric);
      } else if (typeof query?.metric === 'function') {
        query = query.metric(metric);
      } else if (typeof query?.distanceType === 'function') {
        query = query.distanceType(metric);
      }
      return query;
    };

    let firstQuery = null, canPushdown = false;

    const buildQuery = (limit, ids = candidateIds) => {
      let query = firstQuery || createBaseQuery(); firstQuery = null;
      if (canPushdown) {
        if (typeof query?.where !== 'function') throw new Error('LanceDB query builder lost candidate predicate support.');
        query = query.where(`${idColumn} IN (${ids.join(',')})`);
      }
      if (typeof query?.limit === 'function') {
        query = query.limit(limit);
      }
      if (typeof query?.select === 'function') {
        const columns = [idColumn, '_distance'];
        query = query.select(columns.filter(Boolean));
      }
      return query;
    };

    const reducer = createTopKReducer({ k: limitBase, score: hit => hit.sim, id: hit => hit.idx });
    let visited = 0;
    const admitRows = async rows => {
      for (const row of rows || []) {
        if (++visited % 512 === 0) { await yieldImmediate(); throwIfAborted(signal); }
        const idx = readRowId(row, idColumn);
        if (idx == null || (candidateCount && !candidateSetHas(candidateSet, idx))) continue;
        const sim = readRowScore(row, metric);
        if (sim == null) continue;
        reducer.push(withAnnScoreSpace({ idx, sim }, { metric, kind: metric === 'cosine' ? 'cosine' : 'negative-distance',
          backend: 'lancedb', distance: row?._distance ?? row?.distance ?? null }));
      }
    };

    try {
      firstQuery = createBaseQuery();
      canPushdown = Boolean(candidateIds.length && typeof firstQuery?.where === 'function');
      if (canPushdown) {
      // Preserve every candidate partition's native head, then retain the best
      // observed eligible hits. This does not certify native ANN recall.
        for (let start = 0; start < candidateIds.length; start += CANDIDATE_PUSH_LIMIT) {
          if (start && start % (CANDIDATE_PUSH_LIMIT * 16) === 0) await yieldImmediate();
          throwIfAborted(signal);
          const rows = await toArray(buildQuery(limitBase, candidateIds.slice(start, start + CANDIDATE_PUSH_LIMIT)));
          throwIfAborted(signal);
          await admitRows(rows);
        }
      } else {
      // Without backend filtering, a complete scan is required. A multiplier
      // based on candidate count cannot bound the nearest allowed row's rank.
        const limit = candidateCount ? Number(await table.countRows?.()) : limitBase;
        throwIfAborted(signal);
        if (!Number.isSafeInteger(limit) || limit <= 0) return [];
        const rows = await toArray(buildQuery(limit));
        throwIfAborted(signal);
        await admitRows(rows);
      }
      throwIfAborted(signal);
      return reducer.finish({ limit: limitBase });
    } catch (err) {
      throwIfAborted(signal);
      warnOnce('lancedb-query', `[ann] LanceDB query failed; falling back to other ANN backends. ${err?.message || err}`);
      return [];
    }
  } finally { await tableLease.release(); }
}
