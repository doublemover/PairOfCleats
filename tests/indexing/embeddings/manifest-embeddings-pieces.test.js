#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/dict-utils.js';
import { syncProcessEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = path.join(root, '.testCache', 'manifest-embeddings-pieces');

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
syncProcessEnv(env);

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const run = (args, label) => {
  const result = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
};

run([path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', fixtureRoot], 'build index');
run([path.join(root, 'tools', 'build-embeddings.js'), '--stub-embeddings', '--repo', fixtureRoot], 'build embeddings');

const userConfig = loadUserConfig(fixtureRoot);
const codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
const manifestPath = path.join(codeDir, 'pieces', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`Missing pieces manifest at ${manifestPath}`);
  process.exit(1);
}

let manifestRaw;
try {
  manifestRaw = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
} catch {
  console.error('Failed to parse pieces manifest JSON.');
  process.exit(1);
}
const manifest = manifestRaw?.fields && typeof manifestRaw.fields === 'object' ? manifestRaw.fields : manifestRaw;
const pieces = Array.isArray(manifest?.pieces) ? manifest.pieces : [];
const byName = new Map();
for (const entry of pieces) {
  if (entry && typeof entry.name === 'string') {
    byName.set(entry.name, entry);
  }
}

const ensureEntry = (name) => {
  if (!byName.has(name)) {
    console.error(`Expected manifest entry for ${name}`);
    process.exit(1);
  }
};

const assertPathMatch = (name, relPath, kind) => {
  const entry = byName.get(name) || null;
  const absPath = path.join(codeDir, relPath);
  const exists = fs.existsSync(absPath) && (kind !== 'dir' || fs.statSync(absPath).isDirectory());
  if (exists && !entry) {
    console.error(`Expected manifest entry for ${name} when ${relPath} exists.`);
    process.exit(1);
  }
  if (entry && !exists) {
    console.error(`Manifest entry ${name} points to missing ${relPath}.`);
    process.exit(1);
  }
};

ensureEntry('dense_vectors');
ensureEntry('dense_vectors_doc');
ensureEntry('dense_vectors_code');

assertPathMatch('dense_vectors', 'dense_vectors_uint8.json', 'file');
assertPathMatch('dense_vectors_doc', 'dense_vectors_doc_uint8.json', 'file');
assertPathMatch('dense_vectors_code', 'dense_vectors_code_uint8.json', 'file');

assertPathMatch('dense_vectors_hnsw', 'dense_vectors_hnsw.bin', 'file');
assertPathMatch('dense_vectors_hnsw_meta', 'dense_vectors_hnsw.meta.json', 'file');
assertPathMatch('dense_vectors_doc_hnsw', 'dense_vectors_doc_hnsw.bin', 'file');
assertPathMatch('dense_vectors_doc_hnsw_meta', 'dense_vectors_doc_hnsw.meta.json', 'file');
assertPathMatch('dense_vectors_code_hnsw', 'dense_vectors_code_hnsw.bin', 'file');
assertPathMatch('dense_vectors_code_hnsw_meta', 'dense_vectors_code_hnsw.meta.json', 'file');

assertPathMatch('dense_vectors_lancedb', 'dense_vectors.lancedb', 'dir');
assertPathMatch('dense_vectors_lancedb_meta', 'dense_vectors.lancedb.meta.json', 'file');
assertPathMatch('dense_vectors_doc_lancedb', 'dense_vectors_doc.lancedb', 'dir');
assertPathMatch('dense_vectors_doc_lancedb_meta', 'dense_vectors_doc.lancedb.meta.json', 'file');
assertPathMatch('dense_vectors_code_lancedb', 'dense_vectors_code.lancedb', 'dir');
assertPathMatch('dense_vectors_code_lancedb_meta', 'dense_vectors_code.lancedb.meta.json', 'file');

assertPathMatch('dense_vectors_sqlite_vec_meta', 'dense_vectors_sqlite_vec.meta.json', 'file');

console.log('manifest embeddings pieces test passed');
