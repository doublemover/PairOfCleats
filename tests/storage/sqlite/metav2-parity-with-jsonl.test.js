#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { ensureFixtureIndex, ensureFixtureSqlite, loadFixtureIndexMeta } from '../../helpers/fixture-index.js';
import { resolveSqlitePaths } from '../../../tools/dict-utils.js';
import { validateSqliteMetaV2Parity } from '../../../src/index/validate/checks.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.error('better-sqlite3 is required for sqlite parity tests.');
  process.exit(1);
}

const buildReport = () => ({
  issues: [],
  warnings: [],
  hints: []
});

const { fixtureRoot, env, userConfig, codeDir } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'sqlite-metav2-parity'
});
await ensureFixtureSqlite({ fixtureRoot, userConfig, env });

const { chunkMeta } = loadFixtureIndexMeta(fixtureRoot, userConfig);
const sqlitePaths = resolveSqlitePaths(fixtureRoot, userConfig);
const db = new Database(sqlitePaths.codePath, { readonly: true });
const rows = db
  .prepare('SELECT id, chunk_id, metaV2_json FROM chunks WHERE mode = ? ORDER BY id LIMIT ?')
  .all('code', 12);

const report = buildReport();
validateSqliteMetaV2Parity(report, 'code', chunkMeta, rows, { maxErrors: 5 });

db.close();

assert.equal(report.issues.length, 0, `sqlite metaV2 parity issues: ${report.issues.join(', ')}`);

console.log('sqlite metaV2 parity with jsonl ok');
