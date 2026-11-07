import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { open } from 'lmdb';
import { createBaseIndex } from '../../indexing/validate/helpers.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { createLmdbHelpers } from '../../../src/retrieval/lmdb-helpers.js';
import { loadIndex } from '../../../src/retrieval/cli-index.js';
import { decodeLmdbValue } from '../../../src/storage/lmdb/utils.js';
import { closeLmdbDatabase } from '../../../src/storage/lmdb/close.js';
import { LMDB_ARTIFACT_KEYS } from '../../../src/storage/lmdb/schema.js';
import { resolveLmdbPaths } from '../../../tools/dict-utils/paths/db.js';

const format = process.env.PAIROFCLEATS_TEST_ID?.split('native-artifact-parity/')[1];
assert.ok(['json', 'jsonl', 'columnar'].includes(format));
const { dir } = await prepareIsolatedTestCacheDir(`lmdb-native-parity-${format}`);
const repo = path.join(dir, 'repo'), cacheRoot = path.join(dir, 'cache');
await fs.mkdir(repo);
const config = { cache: { root: cacheRoot }, search: { annDefault: false } };
await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify(config));
const files = [{ id: 0, file: 'a.js', ext: '.js', last_author: 'Ada', last_modified: 123, churn: 7,
  churn_added: 3, churn_deleted: 4, churn_commits: 2, externalDocs: ['a.md'] },
{ id: 1, file: 'b.js', ext: '.js', last_author: 'Grace', churn: 9 }];
const fields = [{ body: ['alpha'] }, { body: ['beta'] }];
const { indexRoot, indexDir, manifest } = await createBaseIndex({ rootDir: repo,
  chunkMeta: [{ id: 0, fileId: 0, file: 'a.js', ext: '.js', start: 0, end: 1 },
    { id: 1, fileId: 1, file: 'b.js', ext: '.js', start: 0, end: 1, churn: 0 }], fileMeta: files,
  tokenPostings: { totalDocs: 2, avgDocLen: 1, vocab: ['alpha', 'beta'], postings: [[[0, 1]], [[1, 1]]], docLengths: [1, 1] } });
manifest.pieces = manifest.pieces.filter(piece => !['file_meta', 'field_tokens'].includes(piece.name));
const selectedFiles = new Map();
for (const [name, rows] of [['file_meta', files], ['field_tokens', fields]]) {
  const base = `selected-${name}`;
  if (format === 'jsonl') {
    const parts = [];
    for (let index = 0; index < rows.length; index++) {
      const part = `${base}.part-${index}.jsonl`; parts.push(part);
      await fs.writeFile(path.join(indexDir, part), JSON.stringify(rows[index]) + '\n');
      manifest.pieces.push({ name, path: part, format: 'jsonl', count: 1 });
    }
    await fs.writeFile(path.join(indexDir, `${name}.meta.json`), JSON.stringify({ format: 'jsonl-sharded', parts, count: rows.length }));
    manifest.pieces.push({ name: `${name}_meta`, path: `${name}.meta.json`, format: 'json' });
    selectedFiles.set(name, parts[0]);
  } else {
    const file = `${base}.${format}.json`;
    const columns = [...new Set(rows.flatMap(Object.keys))];
    const payload = format === 'json' ? rows : { format: 'columnar', columns, length: rows.length,
      arrays: Object.fromEntries(columns.map(key => [key, rows.map(row => row[key] ?? null)])) };
    await fs.writeFile(path.join(indexDir, file), JSON.stringify(payload));
    manifest.pieces.push({ name, path: file, format }); selectedFiles.set(name, file);
  }
  await fs.writeFile(path.join(indexDir, `${name}.json`), '["stale unselected alias"]');
}
await fs.writeFile(path.join(indexDir, 'pieces/manifest.json'), JSON.stringify(manifest));
const env = applyTestEnv({ cacheRoot, syncProcess: false, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const build = () => spawnSubprocess(process.execPath, ['tools/build/lmdb-index.js', '--repo', repo,
  '--mode', 'code', '--index-root', indexRoot], { cwd: process.cwd(), env, timeoutMs: 10000,
  stdio: 'pipe', maxOutputBytes: 32768, rejectOnNonZeroExit: false });
const result = await build(); assert.equal(result.exitCode, 0, result.stderr);
const dbPath = resolveLmdbPaths(repo, config, { indexRoot }).codePath;
const read = async action => {
  const db = open({ path: dbPath, readOnly: true });
  try { return await action(db); } finally { await closeLmdbDatabase(db, db.close); }
};
const options = { includeDense: false, includeHnsw: false, includeMinhash: false, includeFilterIndex: false };
await read(async db => {
  const meta = decodeLmdbValue(db.get(LMDB_ARTIFACT_KEYS.fileMeta));
  assert.equal(meta[0].last_author, 'Ada'); assert.equal(meta[1].last_author, 'Grace');
  assert.deepEqual(decodeLmdbValue(db.get(LMDB_ARTIFACT_KEYS.fieldTokens)), fields);
  const helpers = createLmdbHelpers({ getDb: () => db, hnswConfig: { enabled: false } });
  const nativeIndex = helpers.loadIndexFromLmdb('code', options);
  const memoryIndex = await loadIndex(indexDir, options);
  const project = index => index.chunkMeta.map(row => Object.fromEntries([
    'file', 'ext', 'last_author', 'last_modified', 'externalDocs', 'churn', 'churn_added', 'churn_deleted', 'churn_commits'
  ].map(key => [key, row[key] ?? null])));
  assert.deepEqual(project(nativeIndex), project(memoryIndex), 'actual native and memory readers retain the same file metadata');
  assert.equal(nativeIndex.chunkMeta[0].churn, 7); assert.equal(nativeIndex.chunkMeta[1].churn, 0);
  assert.deepEqual(nativeIndex.fieldTokens, fields);
});
const previous = await read(db => Buffer.from(db.get(LMDB_ARTIFACT_KEYS.fileMeta)));
for (const name of ['file_meta', 'field_tokens']) {
  const selected = path.join(indexDir, selectedFiles.get(name)), bytes = await fs.readFile(selected);
  try {
    await fs.writeFile(selected, '{broken selected input');
    const rejected = await build(); assert.notEqual(rejected.exitCode, 0, 'declared unreadable input cannot publish a successful store');
    await read(db => assert.deepEqual(Buffer.from(db.get(LMDB_ARTIFACT_KEYS.fileMeta)), previous,
      'source admission fails before replacing the prior native payload'));
  } finally { await fs.writeFile(selected, bytes); }
}
console.log(`Actual LMDB ${format} builder/reader parity preserves author/churn/docs/field tokens and rejects corrupt selected inputs.`);
