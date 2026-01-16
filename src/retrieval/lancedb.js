import fs from 'node:fs';
import { tryImport } from '../shared/optional-deps.js';
import { normalizeLanceDbConfig } from '../shared/lancedb.js';

const CANDIDATE_PUSH_LIMIT = 500;

let cachedModule = null;
let warnedMissing = false;
let warnedQuery = false;

const warnOnce = (message) => {
  if (warnedQuery) return;
  warnedQuery = true;
  console.warn(message);
};

const loadLanceDb = async () => {
  if (cachedModule) return cachedModule;
  const result = await tryImport('@lancedb/lancedb');
  if (!result.ok) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn('[ann] LanceDB unavailable; falling back to other ANN backends.');
    }
    return null;
  }
  cachedModule = result.mod?.default || result.mod;
  return cachedModule;
};

const connectionCache = new Map();

const getConnection = async (dir) => {
  if (!dir) return null;
  if (connectionCache.has(dir)) return connectionCache.get(dir);
  const lancedb = await loadLanceDb();
  const connect = lancedb?.connect || lancedb?.default?.connect;
  if (!connect) return null;
  const db = await connect(dir);
  const entry = { db, tables: new Map() };
  connectionCache.set(dir, entry);
  return entry;
};

const getTable = async (dir, tableName) => {
  const connection = await getConnection(dir);
  if (!connection || !tableName) return null;
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

const normalizeSim = (distance, metric) => {
  if (!Number.isFinite(distance)) return null;
  if (metric === 'l2') return -distance;
  if (metric === 'cosine') return 1 - distance;
  return distance;
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
    return normalizeSim(Number(distanceRaw), metric);
  }
  const scoreRaw = row?.score ?? row?._score ?? row?.sim ?? row?.similarity;
  const score = Number(scoreRaw);
  return Number.isFinite(score) ? score : null;
};

export async function rankLanceDb({
  lancedbInfo,
  queryEmbedding,
  topN,
  candidateSet,
  config
}) {
  if (!lancedbInfo?.available) return [];
  if (!Array.isArray(queryEmbedding) || !queryEmbedding.length) return [];
  const resolvedConfig = normalizeLanceDbConfig(config);
  if (!resolvedConfig.enabled) return [];

  const meta = lancedbInfo.meta || {};
  const tableName = meta.table || resolvedConfig.table;
  const idColumn = meta.idColumn || resolvedConfig.idColumn;
  const embeddingColumn = meta.embeddingColumn || resolvedConfig.embeddingColumn;
  const metric = meta.metric || resolvedConfig.metric;
  const dims = Number.isFinite(Number(meta.dims)) ? Number(meta.dims) : null;
  if (dims && queryEmbedding.length !== dims) return [];

  const dir = lancedbInfo.dir;
  if (!dir || !fs.existsSync(dir)) return [];

  let table;
  try {
    table = await getTable(dir, tableName);
  } catch (err) {
    warnOnce(`[ann] LanceDB table load failed; falling back to other ANN backends. ${err?.message || err}`);
    return [];
  }
  if (!table || typeof table.search !== 'function') return [];

  const limitBase = Math.max(1, Number(topN) || 1);
  const candidateCount = candidateSet && candidateSet.size ? candidateSet.size : 0;
  const limit = candidateCount
    ? Math.min(Math.max(limitBase * 4, limitBase + 10), candidateCount)
    : limitBase;
  let query;
  if (embeddingColumn !== 'vector' && table.search.length > 1) {
    query = table.search(queryEmbedding, { vectorColumn: embeddingColumn });
  } else {
    query = table.search(queryEmbedding);
  }
  if (typeof query?.metricType === 'function') {
    query = query.metricType(metric);
  } else if (typeof query?.metric === 'function') {
    query = query.metric(metric);
  } else if (typeof query?.distanceType === 'function') {
    query = query.distanceType(metric);
  }
  const canPushdown = candidateCount > 0
    && candidateCount <= CANDIDATE_PUSH_LIMIT
    && typeof query?.where === 'function';
  if (canPushdown) {
    const ids = Array.from(candidateSet).filter((id) => Number.isFinite(Number(id)));
    if (ids.length) {
      query = query.where(`${idColumn} IN (${ids.join(',')})`);
    }
  }
  if (typeof query.limit === 'function') query = query.limit(limit);
  if (typeof query.select === 'function') {
    const columns = [idColumn, '_distance'];
    query = query.select(columns.filter(Boolean));
  }

  let rows;
  try {
    rows = await toArray(query);
  } catch (err) {
    warnOnce(`[ann] LanceDB query failed; falling back to other ANN backends. ${err?.message || err}`);
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
  return filtered
    .sort((a, b) => (b.sim - a.sim) || (a.idx - b.idx))
    .slice(0, limitBase);
}
