import { createMultiRowInserter } from './build/multi-row.js';

export const FTS_VARIANT_TABLES = Object.freeze({
  unicode61: 'chunks_fts', trigram: 'chunks_fts_trigram', porter: 'chunks_fts_porter'
});
const FTS_COLUMNS = Object.freeze(['rowid', 'file', 'name', 'signature', 'kind', 'headline', 'doc', 'tokens']);
export const SQLITE_FTS_ROW_KEYS = Object.freeze(['id', 'file', 'name', 'signature', 'kind', 'headline', 'doc', 'tokensText']);
export const normalizeFtsVariants = (variants = []) => {
  if (!Array.isArray(variants) || variants.some(value => !['trigram', 'porter'].includes(value))) {
    throw new TypeError('ftsVariants must contain only trigram and porter');
  }
  return [...new Set(variants)].sort();
};
export const listOptionalFtsTables = db => Object.values(FTS_VARIANT_TABLES).slice(1).filter(table =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
export const createOptionalFtsTables = (db, variants = []) => {
  for (const variant of normalizeFtsVariants(variants)) {
    const table = FTS_VARIANT_TABLES[variant];
    const identifiers = variant === 'porter'
      ? 'file UNINDEXED, name UNINDEXED, signature UNINDEXED, kind UNINDEXED'
      : 'file, name, signature, kind';
    db.exec(`CREATE VIRTUAL TABLE ${table} USING fts5(${identifiers}, headline, doc, tokens,
      content='', contentless_delete=1, tokenize='${variant === 'porter' ? 'porter unicode61' : 'trigram'}');`);
  }
};
export const createFtsInserter = (db, insertClause = 'INSERT OR REPLACE') => {
  const statements = ['chunks_fts', ...listOptionalFtsTables(db)].map(table => db.prepare(
    `${insertClause} INTO ${table} (${FTS_COLUMNS.join(',')})
      VALUES (${SQLITE_FTS_ROW_KEYS.map(key => '@' + key).join(',')})`));
  return { run: row => { for (const statement of statements) statement.run(row); } };
};

/** Full-build positional batches retain the same FTS fields and variant tables. */
export const createFtsMultiRowInserter = (db, { insertClause = 'INSERT', stats = null } = {}) => {
  const inserters = ['chunks_fts', ...listOptionalFtsTables(db)].map(table => createMultiRowInserter(db, {
    table, columns: FTS_COLUMNS, insertClause, stats
  }));
  const insert = rows => { for (const inserter of inserters) inserter(rows); };
  insert.maxRows = Math.min(...inserters.map(inserter => inserter.maxRows));
  return insert;
};
export const insertOptionalFtsFromStage = db => {
  for (const table of listOptionalFtsTables(db)) {
    db.exec(`INSERT OR REPLACE INTO ${table} (rowid,file,name,signature,kind,headline,doc,tokens)
      SELECT c.id,COALESCE(c.file,f.file),c.name,c.signature,c.kind,c.headline,c.doc,c.tokensText
      FROM chunks_stage c LEFT JOIN file_meta_stage f ON c.file_id=f.id;`);
  }
};
