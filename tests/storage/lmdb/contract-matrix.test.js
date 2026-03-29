#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { Packr, Unpackr } from 'msgpackr';

import { applyTestEnv } from '../../helpers/test-env.js';
import { requireOrSkip } from '../../helpers/require-or-skip.js';
import { getCombinedOutput } from '../../helpers/stdio.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { LMDB_META_KEYS, LMDB_SCHEMA_VERSION } from '../../../src/storage/lmdb/schema.js';
import {
  createLmdbCodec,
  decodeLmdbValue,
  hasLmdbStore,
  validateLmdbArtifactKeys,
  validateLmdbSchemaAndMode
} from '../../../src/storage/lmdb/utils.js';
import { resolveLmdbPaths } from '../../../tools/shared/dict-utils.js';

requireOrSkip({ capability: 'lmdb', reason: 'Skipping lmdb contract matrix; lmdb not available.' });

const { open } = await import('lmdb');
const packr = new Packr();
const unpackr = new Unpackr();
const encode = (value) => packr.pack(value);
const decode = (value) => (value == null ? null : unpackr.unpack(value));
const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'lmdb-contract-matrix');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

{
  const missingStore = path.join(tempRoot, 'missing-store');
  assert.equal(hasLmdbStore(missingStore), false);
  await fsPromises.mkdir(missingStore, { recursive: true });
  assert.equal(hasLmdbStore(missingStore), false);
  await fsPromises.writeFile(path.join(missingStore, 'data.mdb'), Buffer.from('x'));
  assert.equal(hasLmdbStore(missingStore), true);

  const sample = { ok: true, nested: { count: 2 } };
  const codec = createLmdbCodec();
  assert.deepEqual(codec.decode(encode(sample)), sample);
  assert.deepEqual(decodeLmdbValue(encode(sample)), sample);

  const metadata = new Map([
    [LMDB_META_KEYS.schemaVersion, encode(LMDB_SCHEMA_VERSION)],
    [LMDB_META_KEYS.mode, encode('code')],
    [LMDB_META_KEYS.artifacts, encode(['chunk_meta', 'token_postings'])],
    ['chunk_meta', encode([{ id: 1 }])],
    ['token_postings', encode({ vocab: [], postings: [] })]
  ]);
  const db = { get(key) { return metadata.has(key) ? metadata.get(key) : null; } };
  const schemaOk = validateLmdbSchemaAndMode({ db, label: 'code', decode: decodeLmdbValue });
  assert.equal(schemaOk.ok, true);
  metadata.set(LMDB_META_KEYS.mode, encode('prose'));
  const schemaMismatch = validateLmdbSchemaAndMode({ db, label: 'code', decode: decodeLmdbValue });
  assert.equal(schemaMismatch.ok, false);
  assert.equal(schemaMismatch.issues.some((issue) => issue.includes('mode mismatch')), true);
  metadata.set(LMDB_META_KEYS.mode, encode('code'));
  const artifactOk = validateLmdbArtifactKeys({ db, requiredKeys: ['chunk_meta', 'token_postings'], decode: decodeLmdbValue });
  assert.equal(artifactOk.ok, true);
  metadata.set(LMDB_META_KEYS.artifacts, encode(['chunk_meta']));
  const artifactMismatch = validateLmdbArtifactKeys({ db, requiredKeys: ['chunk_meta', 'token_postings'], decode: decodeLmdbValue });
  assert.equal(artifactMismatch.ok, false);
  metadata.delete('token_postings');
  metadata.set(LMDB_META_KEYS.artifacts, encode(['chunk_meta', 'token_postings']));
  const artifactMissingValue = validateLmdbArtifactKeys({ db, requiredKeys: ['chunk_meta', 'token_postings'], decode: decodeLmdbValue });
  assert.equal(artifactMissingValue.ok, false);
}

{
  const caseRoot = path.join(tempRoot, 'backend');
  const repoRoot = path.join(caseRoot, 'repo');
  const cacheRoot = path.join(caseRoot, 'cache');
  await fsPromises.mkdir(repoRoot, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  await fsPromises.writeFile(path.join(repoRoot, 'alpha.js'), 'const alpha = 1;\n');
  await fsPromises.writeFile(path.join(repoRoot, 'beta.js'), 'const beta = 2;\n');
  const env = applyTestEnv({ cacheRoot, embeddings: 'stub' });

  const runNode = (label, args) => {
    const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
    assert.equal(result.status, 0, `Failed: ${label}`);
  };
  runNode('build_index', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot]);
  runNode('build_lmdb_index', [path.join(root, 'tools', 'build/lmdb-index.js'), '--mode', 'code', '--repo', repoRoot]);

  const lmdbPaths = resolveLmdbPaths(repoRoot, {});
  const dbPath = lmdbPaths.codePath;
  assert.ok(fs.existsSync(path.join(dbPath, 'data.mdb')));
  const db = open({ path: dbPath, readOnly: true });
  assert.equal(decode(db.get(LMDB_META_KEYS.schemaVersion)), LMDB_SCHEMA_VERSION);
  assert.equal(decode(db.get(LMDB_META_KEYS.mode)), 'code');
  assert.ok(Number(decode(db.get(LMDB_META_KEYS.chunkCount)) || 0) > 0);
  const mapSizeBytes = Number(decode(db.get(LMDB_META_KEYS.mapSizeBytes)));
  const mapSizeEstimatedBytes = Number(decode(db.get(LMDB_META_KEYS.mapSizeEstimatedBytes)));
  db.close();
  assert.ok(Number.isFinite(mapSizeBytes) && mapSizeBytes > 0);
  assert.ok(Number.isFinite(mapSizeEstimatedBytes) && mapSizeEstimatedBytes >= 0);
  assert.ok(mapSizeBytes >= mapSizeEstimatedBytes);

  const searchResult = spawnSync(
    process.execPath,
    [path.join(root, 'search.js'), 'alpha', '--json', '--backend', 'lmdb', '--mode', 'code', '--no-ann', '--repo', repoRoot],
    { encoding: 'utf8', env }
  );
  assert.equal(searchResult.status, 0);
  const payload = JSON.parse(String(searchResult.stdout || '{}').trim());
  assert.equal(payload.backend, 'lmdb');

  const dbWrite = open({ path: dbPath, readOnly: false });
  dbWrite.putSync(LMDB_META_KEYS.schemaVersion, encode(LMDB_SCHEMA_VERSION + 1));
  dbWrite.close();
  const badSearch = spawnSync(
    process.execPath,
    [path.join(root, 'search.js'), 'alpha', '--json', '--backend', 'lmdb', '--mode', 'code', '--no-ann', '--repo', repoRoot],
    { encoding: 'utf8', env }
  );
  assert.notEqual(badSearch.status, 0);
  assert.ok(getCombinedOutput(badSearch).includes('schema mismatch'));
}

console.log('lmdb contract matrix test passed');
