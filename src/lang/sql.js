/**
 * SQL language surface exported to indexing registry.
 *
 * This module intentionally re-exports stable entry points so callers do not
 * depend on individual implementation file paths.
 */
export {
  SQL_RESERVED_WORDS_COMMON,
  POSTGRES_RESERVED_WORDS,
  MYSQL_RESERVED_WORDS,
  SQLITE_RESERVED_WORDS,
  SQL_RESERVED_WORDS
} from './sql/constants.js';

export { collectSqlImports } from './sql/imports.js';
export { buildSqlChunks } from './sql/chunking.js';
export { buildSqlRelations } from './sql/relations.js';
export { computeSqlFlow } from './sql/flow.js';
export { extractSqlDocMeta } from './sql/doc.js';
