import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const SQL_RELATION_PRODUCER_VERSION = '3';
export const sqlRelationParserVersion = () => {
  try { return require('node-sql-parser/package.json').version; } catch { return null; }
};
