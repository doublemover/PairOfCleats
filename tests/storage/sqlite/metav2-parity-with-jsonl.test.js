#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { ensureFixtureIndex, ensureFixtureSqlite, loadFixtureIndexMeta } from '../../helpers/fixture-index.js';
import { resolveSqlitePaths } from '../../../tools/shared/dict-utils.js';
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
  cacheName: 'sqlite-metav2-parity',
  cacheScope: 'shared'
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

const reverseObjects = value => Array.isArray(value) ? value.map(reverseObjects)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseObjects(child)])) : value;
assert.ok(rows.length > 0, 'native SQLite/JSONL positive control must contain admitted rows');
const projected = new Database(':memory:');
projected.exec('CREATE TABLE samples(id INTEGER,chunk_id TEXT,metaV2_json TEXT)');
try {
  const insert = projected.prepare('INSERT INTO samples VALUES(?,?,?)');
  for (const row of rows) insert.run(row.id, row.chunk_id, JSON.stringify(reverseObjects(JSON.parse(row.metaV2_json))));
  const read = () => projected.prepare('SELECT * FROM samples ORDER BY id').all();
  const reordered = buildReport();
  validateSqliteMetaV2Parity(reordered, 'code', chunkMeta, read());
  assert.deepEqual(reordered.issues, [], 'reordering every top-level/nested object preserves real persisted parity');
  const first = rows[0], original = JSON.parse(first.metaV2_json);
  for (const [name, mutate] of [
    ['scalar', meta => { meta.file += '.different'; }],
    ['nested', meta => { meta.range = { ...meta.range, start: (meta.range?.start || 0) + 1 }; }]
  ]) {
    const changed = structuredClone(original); mutate(changed);
    projected.prepare('UPDATE samples SET metaV2_json=? WHERE id=?').run(JSON.stringify(changed), first.id);
    const mismatch = buildReport(); validateSqliteMetaV2Parity(mismatch, 'code', chunkMeta, read());
    assert.equal(mismatch.issues.length, 1, name + ' remains a genuine selected-field mismatch');
  }
  const expected = structuredClone(chunkMeta), withArray = structuredClone(original);
  withArray.types = { parameters: [{ name: 'first', type: 'string' }, { name: 'second', type: 'number' }] };
  expected[first.id].metaV2 = structuredClone(withArray);
  withArray.types.parameters.reverse();
  projected.prepare('UPDATE samples SET metaV2_json=? WHERE id=?').run(JSON.stringify(withArray), first.id);
  const mismatch = buildReport(); validateSqliteMetaV2Parity(mismatch, 'code', expected, read());
  assert.equal(mismatch.issues.length, 1, 'canonicalization never reorders semantic arrays');
  projected.prepare('UPDATE samples SET metaV2_json=? WHERE id=?').run('{invalid', first.id);
  const invalid = buildReport(); validateSqliteMetaV2Parity(invalid, 'code', chunkMeta, read());
  assert.ok(invalid.issues[0].includes('invalid'));
} finally { projected.close(); }

console.log('sqlite metaV2 parity with jsonl ok');
