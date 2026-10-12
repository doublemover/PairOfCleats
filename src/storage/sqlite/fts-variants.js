export const FTS_VARIANT_TABLES = Object.freeze({
  unicode61: 'chunks_fts', trigram: 'chunks_fts_trigram', porter: 'chunks_fts_porter'
});
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
    `${insertClause} INTO ${table} (rowid,file,name,signature,kind,headline,doc,tokens)
      VALUES (@id,@file,@name,@signature,@kind,@headline,@doc,@tokensText)`));
  return { run: row => { for (const statement of statements) statement.run(row); } };
};
export const insertOptionalFtsFromStage = db => {
  for (const table of listOptionalFtsTables(db)) {
    db.exec(`INSERT OR REPLACE INTO ${table} (rowid,file,name,signature,kind,headline,doc,tokens)
      SELECT c.id,COALESCE(c.file,f.file),c.name,c.signature,c.kind,c.headline,c.doc,c.tokensText
      FROM chunks_stage c LEFT JOIN file_meta_stage f ON c.file_id=f.id;`);
  }
};
