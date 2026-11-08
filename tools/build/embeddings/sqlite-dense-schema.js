import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const invalid = message => Object.assign(new Error(message), { code: 'ERR_SQLITE_DENSE_SCHEMA' });
const requireIdentifier = value => { if (typeof value !== 'string' || !identifier.test(value)) throw invalid('Invalid SQLite dense schema identifier.'); };
const project = (observation, operation) => {
  try { const result = operation(); observation.requireSettled(); return result; }
  catch (error) { throw observation.wrap(error); }
};
const dimensions = value => {
  if (typeof value !== 'string') return null;
  const match = /\[\s*(\d+)\s*\]/u.exec(value);
  if (!match) return null;
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count <= 0) throw invalid('Invalid declared SQLite vector dimensions.');
  return count;
};

/** Query failure is not missing-table evidence. Only an actual absent row can
 * select the existing missing-table path; original resources precede projection.
 */
export const hasSqliteDenseTable = (db, table) => {
  requireIdentifier(table);
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
  const observation = observeStorageResource(row, { phase: 'sqlite-dense-table-query' }); observation.requireSettled();
  return project(observation, () => {
    if (row !== undefined && (row === null || typeof row !== 'object' || row.name !== table)) throw invalid('Invalid SQLite table-catalog result.');
    return row !== undefined;
  });
};

export const resolveSqliteDenseVectorTableDims = (db, table, column) => {
  requireIdentifier(table); requireIdentifier(column);
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  const observed = observeStorageResource(rows, { phase: 'sqlite-dense-column-query' }); observed.requireSettled();
  return project(observed, () => {
    if (!Array.isArray(rows)) throw invalid('Invalid SQLite column-catalog result.');
    const selected = rows.filter(row => row?.name === column);
    if (selected.length > 1) throw invalid('Duplicate SQLite vector columns.');
    if (!selected.length) return null;
    const declared = dimensions(selected[0].type);
    observed.requireSettled();
    if (declared !== null) return declared;
    const row = db.prepare("SELECT substr(sql, 1, 65537) AS sql FROM sqlite_master WHERE type='table' AND name = ?").get(table);
    const catalog = observeStorageResource(row, { phase: 'sqlite-dense-vector-ddl' }); catalog.requireSettled();
    return project(catalog, () => {
      const sql = row?.sql;
      if (sql !== undefined && sql !== null && typeof sql !== 'string') throw invalid('Invalid SQLite vector table SQL.');
      if (typeof sql === 'string' && sql.length > 65536) throw invalid('SQLite vector table SQL exceeds its bounded projection.');
      // The existing producer emits one leading vector column. Restrict fallback
      // to that exact column/shape; another column's width cannot authorize DROP.
      const name = `(?:${column}|"${column}"|\\[${column}\\]|\x60${column}\x60)`;
      const tableName = `(?:${table}|"${table}"|\\[${table}\\]|\x60${table}\x60)`;
      const match = typeof sql === 'string' ? new RegExp(`^\\s*CREATE\\s+VIRTUAL\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${tableName}\\s+USING\\s+[A-Za-z_][A-Za-z0-9_]*\\s*\\(\\s*${name}\\s+float\\s*(\\[\\s*\\d+\\s*\\])`, 'iu').exec(sql) : null;
      return match ? dimensions(match[1]) : null;
    });
  });
};
