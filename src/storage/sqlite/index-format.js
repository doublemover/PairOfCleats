import { assertCurrentIndexFormat } from '../../contracts/index-format.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { SCHEMA_VERSION } from './schema.js';

export const CREATE_INDEX_FORMAT_META_SQL = 'CREATE TABLE IF NOT EXISTS index_format_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)';
export const writeSqliteIndexFormat = (db) => {
  db.exec(CREATE_INDEX_FORMAT_META_SQL);
  db.prepare('INSERT OR REPLACE INTO index_format_meta(key,value) VALUES (?,?)')
    .run('artifactSurfaceVersion', ARTIFACT_SURFACE_VERSION);
};
export const assertSqliteIndexFormat = ({ db, repoRoot, indexPath, operation = 'read' }) => {
  const check = (component, foundVersion, expectedVersion) => assertCurrentIndexFormat({
    operation, component, foundVersion, expectedVersion, repoRoot, indexPath
  });
  check('SQLite schema', db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='index_format_meta'").get();
  const surface = table
    ? db.prepare("SELECT value FROM index_format_meta WHERE key='artifactSurfaceVersion'").get()?.value
    : undefined;
  check('SQLite artifact surface', surface, ARTIFACT_SURFACE_VERSION);
};
