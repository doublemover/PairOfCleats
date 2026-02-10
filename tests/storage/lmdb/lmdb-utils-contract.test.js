#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Packr } from 'msgpackr';
import { applyTestEnv } from '../../helpers/test-env.js';
import { LMDB_META_KEYS, LMDB_SCHEMA_VERSION } from '../../../src/storage/lmdb/schema.js';
import {
  createLmdbCodec,
  decodeLmdbValue,
  hasLmdbStore,
  validateLmdbArtifactKeys,
  validateLmdbSchemaAndMode
} from '../../../src/storage/lmdb/utils.js';

applyTestEnv();

const packr = new Packr();
const encode = (value) => packr.pack(value);

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'lmdb-utils-contract');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const missingStore = path.join(tempRoot, 'missing-store');
assert.equal(hasLmdbStore(missingStore), false);
await fs.mkdir(missingStore, { recursive: true });
assert.equal(hasLmdbStore(missingStore), false);
await fs.writeFile(path.join(missingStore, 'data.mdb'), Buffer.from('x'));
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
const db = {
  get(key) {
    return metadata.has(key) ? metadata.get(key) : null;
  }
};

const schemaOk = validateLmdbSchemaAndMode({ db, label: 'code', decode: decodeLmdbValue });
assert.equal(schemaOk.ok, true);
assert.equal(schemaOk.issues.length, 0);

metadata.set(LMDB_META_KEYS.mode, encode('prose'));
const schemaMismatch = validateLmdbSchemaAndMode({ db, label: 'code', decode: decodeLmdbValue });
assert.equal(schemaMismatch.ok, false);
assert.equal(schemaMismatch.issues.some((issue) => issue.includes('mode mismatch')), true);
metadata.set(LMDB_META_KEYS.mode, encode('code'));

const artifactOk = validateLmdbArtifactKeys({
  db,
  requiredKeys: ['chunk_meta', 'token_postings'],
  decode: decodeLmdbValue
});
assert.equal(artifactOk.ok, true);
assert.equal(artifactOk.missingMeta, false);

metadata.set(LMDB_META_KEYS.artifacts, encode(['chunk_meta']));
const artifactMismatch = validateLmdbArtifactKeys({
  db,
  requiredKeys: ['chunk_meta', 'token_postings'],
  decode: decodeLmdbValue
});
assert.equal(artifactMismatch.ok, false);
assert.equal(artifactMismatch.missingArtifactKeys.includes('token_postings'), true);
assert.equal(artifactMismatch.missingArtifactValues.includes('token_postings'), false);

metadata.delete('token_postings');
metadata.set(LMDB_META_KEYS.artifacts, encode(['chunk_meta', 'token_postings']));
const artifactMissingValue = validateLmdbArtifactKeys({
  db,
  requiredKeys: ['chunk_meta', 'token_postings'],
  decode: decodeLmdbValue
});
assert.equal(artifactMissingValue.ok, false);
assert.equal(artifactMissingValue.missingArtifactValues.includes('token_postings'), true);

console.log('lmdb utils contract test passed');
