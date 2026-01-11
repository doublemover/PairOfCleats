import { chunkArray } from '../utils.js';

export function getVocabCount(db, mode, table) {
  const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE mode = ?`)
    .get(mode) || {};
  return Number.isFinite(row.total) ? row.total : 0;
}

export function fetchVocabRows(db, mode, table, idColumn, valueColumn, values) {
  const unique = Array.from(new Set(values.filter(Boolean)));
  if (!unique.length) return [];
  const rows = [];
  for (const chunk of chunkArray(unique)) {
    const placeholders = chunk.map(() => '?').join(',');
    const stmt = db.prepare(
      `SELECT ${idColumn} AS id, ${valueColumn} AS value FROM ${table} ` +
      `WHERE mode = ? AND ${valueColumn} IN (${placeholders})`
    );
    rows.push(...stmt.all(mode, ...chunk));
  }
  return rows;
}

export function ensureVocabIds(
  db,
  mode,
  table,
  idColumn,
  valueColumn,
  values,
  insertStmt,
  options = {}
) {
  const unique = Array.from(new Set(values.filter(Boolean)));
  const totalBefore = getVocabCount(db, mode, table);
  if (!unique.length) {
    return { map: new Map(), inserted: 0, total: totalBefore, skip: false };
  }
  const existing = fetchVocabRows(db, mode, table, idColumn, valueColumn, unique);
  const map = new Map(existing.map((row) => [row.value, row.id]));
  const missing = unique.filter((value) => !map.has(value));
  if (!missing.length) {
    return { map, inserted: 0, total: totalBefore, skip: false };
  }

  const limits = options?.limits || null;
  if (limits && totalBefore > 0) {
    const ratio = missing.length / totalBefore;
    const ratioLimit = Number.isFinite(limits.ratio) ? limits.ratio : null;
    const absLimit = Number.isFinite(limits.absolute) ? limits.absolute : null;
    if ((ratioLimit !== null && ratio > ratioLimit) || (absLimit !== null && missing.length > absLimit)) {
      return {
        map,
        inserted: 0,
        total: totalBefore,
        skip: true,
        reason: `${table} growth ${missing.length}/${totalBefore}`
      };
    }
  }

  missing.sort();
  const maxRow = db.prepare(`SELECT MAX(${idColumn}) AS maxId FROM ${table} WHERE mode = ?`)
    .get(mode);
  let nextId = Number.isFinite(maxRow?.maxId) ? maxRow.maxId + 1 : 0;
  const insertTx = db.transaction(() => {
    for (const value of missing) {
      insertStmt.run(mode, nextId, value);
      map.set(value, nextId);
      nextId += 1;
    }
  });
  insertTx();

  return { map, inserted: missing.length, total: totalBefore + missing.length, skip: false };
}
