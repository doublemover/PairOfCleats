import fs from 'node:fs';
import { distanceToSimilarity } from '../shared/ann-similarity.js';
import { tryImport } from '../shared/optional-deps.js';
import { normalizeLanceDbConfig } from '../shared/lancedb.js';
import { createWarnOnce } from '../shared/logging/warn-once.js';

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
  const tables = entry.tables instanceof Map ? Array.from(entry.tables.values()) : [];
  for (const table of tables) {
    await closeMaybe(table);
  }
  await closeMaybe(entry.db);
  entry.tables = new Map();
  entry.db = null;
  entry.pending = null;
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
  const cached = connectionCache.get(dir);
  if (cached && cached.pending) {
    touchConnectionEntry(cached, now);
    try {
      const db = await cached.pending;
      cached.pending = null;
      if (!cached.db && db) {
        cached.db = db;
      }
      if (cached.db) {
        touchConnectionEntry(cached);
        return cached;
      }
      connectionCache.delete(dir);
      await closeConnectionEntry(cached);
      return null;
    } catch {
      connectionCache.delete(dir);
      await closeConnectionEntry(cached);
      return null;
    }
  }
  if (cached && cached.db) {
    touchConnectionEntry(cached, now);
    return cached;
  }

  const entry = {
    db: null,
    tables: new Map(),
    pending: null,
    lastAccessMs: now,
    expiresAtMs: now + CONNECTION_CACHE_TTL_MS
  };
  const pending = (async () => {
    const lancedb = await loadLanceDb();
    const connect = lancedb?.connect || lancedb?.default?.connect;
    if (!connect) return null;
    return connect(dir);
  })();
  entry.pending = pending;
  connectionCache.set(dir, entry);
  await pruneConnectionCache({ now });
  try {
    const db = await pending;
    entry.pending = null;
    if (!db) {
      connectionCache.delete(dir);
      await closeConnectionEntry(entry);
      return null;
    }
    entry.db = db;
    touchConnectionEntry(entry);
    return entry;
  } catch {
    connectionCache.delete(dir);
    await closeConnectionEntry(entry);
    return null;
  }
};

const getTable = async (dir, tableName) => {
  const connection = await getConnection(dir);
  if (!connection || !tableName) return null;
  touchConnectionEntry(connection);
  if (connection.tables.has(tableName)) return connection.tables.get(tableName);
  const openTable = connection.db?.openTable;
  if (typeof openTable !== 'function') return null;
  const table = await openTable.call(connection.db, tableName);
  connection.tables.set(tableName, table);
  return table;
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
  config
}) {
  if (!lancedbInfo?.available) return [];
  const embeddingArray = Array.isArray(queryEmbedding)
    ? queryEmbedding
    : (ArrayBuffer.isView(queryEmbedding) && !(queryEmbedding instanceof DataView)
      ? Array.from(queryEmbedding)
      : null);
  if (!embeddingArray || !embeddingArray.length) return [];
  const resolvedConfig = normalizeLanceDbConfig(config);
  if (!resolvedConfig.enabled) return [];

  const meta = lancedbInfo.meta || {};
  const tableName = meta.table || resolvedConfig.table;
  const idColumn = meta.idColumn || resolvedConfig.idColumn;
  const embeddingColumn = meta.embeddingColumn || resolvedConfig.embeddingColumn;
  const metric = meta.metric || resolvedConfig.metric;
  const dims = Number.isFinite(Number(meta.dims)) ? Number(meta.dims) : null;
  if (dims && embeddingArray.length !== dims) return [];

  const dir = lancedbInfo.dir;
  if (!dir || !fs.existsSync(dir)) return [];

  let table;
  try {
    table = await getTable(dir, tableName);
  } catch (err) {
    warnOnce(
      'lancedb-table-load',
      `[ann] LanceDB table load failed; falling back to other ANN backends. ${err?.message || err}`
    );
    return [];
  }
  if (!table || typeof table.search !== 'function') return [];

  const limitBase = Math.max(1, Number(topN) || 1);
  const candidateCount = candidateSet && candidateSet.size ? candidateSet.size : 0;
  const initialLimit = candidateCount
    ? Math.min(Math.max(limitBase * 4, limitBase + 10), candidateCount)
    : limitBase;
  const maxLimit = candidateCount
    ? Math.min(candidateCount, Math.max(initialLimit, limitBase * 32))
    : initialLimit;

  const candidateIds = (candidateCount && candidateCount <= CANDIDATE_PUSH_LIMIT && isSafeIdColumn(idColumn))
    ? Array.from(candidateSet)
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id))
    : [];

  const createBaseQuery = () => {
    let query;
    if (embeddingColumn !== 'vector' && table.search.length > 1) {
      query = table.search(embeddingArray, { vectorColumn: embeddingColumn });
    } else {
      query = table.search(embeddingArray);
    }
    if (typeof query?.metricType === 'function') {
      query = query.metricType(metric);
    } else if (typeof query?.metric === 'function') {
      query = query.metric(metric);
    } else if (typeof query?.distanceType === 'function') {
      query = query.distanceType(metric);
    }
    return query;
  };

  const supportsWhere = Boolean(candidateIds.length) && typeof createBaseQuery()?.where === 'function';
  const canPushdown = Boolean(candidateIds.length && supportsWhere);

  const buildQuery = (limit) => {
    let query = createBaseQuery();
    if (canPushdown && typeof query?.where === 'function') {
      query = query.where(`${idColumn} IN (${candidateIds.join(',')})`);
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

  let rows = [];
  let limit = initialLimit;
  const maxIterations = candidateCount && !canPushdown ? 4 : 1;
  for (let attempt = 0; attempt < maxIterations; attempt += 1) {
    try {
      rows = await toArray(buildQuery(limit));
    } catch (err) {
      warnOnce(
        'lancedb-query',
        `[ann] LanceDB query failed; falling back to other ANN backends. ${err?.message || err}`
      );
      return [];
    }
    const hits = [];
    for (const row of rows || []) {
      const idx = readRowId(row, idColumn);
      if (idx == null) continue;
      const sim = readRowScore(row, metric);
      if (sim == null) continue;
      hits.push({ idx, sim });
    }
    const filtered = !candidateCount || canPushdown
      ? hits
      : hits.filter((hit) => candidateSet.has(hit.idx));
    if (filtered.length >= limitBase) {
      return filtered
        .sort((a, b) => (b.sim - a.sim) || (a.idx - b.idx))
        .slice(0, limitBase);
    }
    if (!rows || rows.length < limit) break;
    const nextLimit = Math.min(maxLimit, limit * 2);
    if (nextLimit <= limit) break;
    limit = nextLimit;
  }

  const hits = [];
  for (const row of rows || []) {
    const idx = readRowId(row, idColumn);
    if (idx == null) continue;
    const sim = readRowScore(row, metric);
    if (sim == null) continue;
    hits.push({ idx, sim });
  }
  const filtered = !candidateCount || canPushdown
    ? hits
    : hits.filter((hit) => candidateSet.has(hit.idx));
  return filtered
    .sort((a, b) => (b.sim - a.sim) || (a.idx - b.idx))
    .slice(0, limitBase);
}
