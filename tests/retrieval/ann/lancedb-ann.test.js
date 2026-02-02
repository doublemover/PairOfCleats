#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/dict-utils.js';
import { normalizeLanceDbConfig } from '../../../src/shared/lancedb.js';
import { requireLanceDb } from '../../helpers/optional-deps.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, '.testCache', 'lancedb-ann');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await requireLanceDb({ reason: 'lancedb not available; skipping lancedb-ann test.' });

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const run = (args, label) => {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

run([path.join(root, 'build_index.js'), '--stub-embeddings', '--scm-provider', 'none', '--repo', repoRoot], 'build index');

const userConfig = loadUserConfig(repoRoot);
const lanceConfig = normalizeLanceDbConfig(userConfig.indexing?.embeddings?.lancedb || {});
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const proseDir = getIndexDir(repoRoot, 'prose', userConfig);
const codeDb = path.join(codeDir, 'dense_vectors.lancedb');
const codeDocDb = path.join(codeDir, 'dense_vectors_doc.lancedb');
const codeCodeDb = path.join(codeDir, 'dense_vectors_code.lancedb');
const proseDb = path.join(proseDir, 'dense_vectors.lancedb');
const proseDocDb = path.join(proseDir, 'dense_vectors_doc.lancedb');
const proseCodeDb = path.join(proseDir, 'dense_vectors_code.lancedb');
const codeMeta = path.join(codeDir, 'dense_vectors.lancedb.meta.json');
const codeDocMeta = path.join(codeDir, 'dense_vectors_doc.lancedb.meta.json');
const codeCodeMeta = path.join(codeDir, 'dense_vectors_code.lancedb.meta.json');
const proseMeta = path.join(proseDir, 'dense_vectors.lancedb.meta.json');
const proseDocMeta = path.join(proseDir, 'dense_vectors_doc.lancedb.meta.json');
const proseCodeMeta = path.join(proseDir, 'dense_vectors_code.lancedb.meta.json');

if (!fs.existsSync(codeDb) || !fs.existsSync(codeMeta)) {
  console.error('LanceDB index missing for code mode.');
  process.exit(1);
}
if (!fs.existsSync(codeDocDb) || !fs.existsSync(codeDocMeta)) {
  console.error('LanceDB doc index missing for code mode.');
  process.exit(1);
}
if (!fs.existsSync(codeCodeDb) || !fs.existsSync(codeCodeMeta)) {
  console.error('LanceDB code index missing for code mode.');
  process.exit(1);
}
if (!fs.existsSync(proseDb) || !fs.existsSync(proseMeta)) {
  console.error('LanceDB index missing for prose mode.');
  process.exit(1);
}
if (!fs.existsSync(proseDocDb) || !fs.existsSync(proseDocMeta)) {
  console.error('LanceDB doc index missing for prose mode.');
  process.exit(1);
}
if (!fs.existsSync(proseCodeDb) || !fs.existsSync(proseCodeMeta)) {
  console.error('LanceDB code index missing for prose mode.');
  process.exit(1);
}

const codeState = JSON.parse(fs.readFileSync(path.join(codeDir, 'index_state.json'), 'utf8'));
const proseState = JSON.parse(fs.readFileSync(path.join(proseDir, 'index_state.json'), 'utf8'));
if (codeState?.embeddings?.embeddingIdentity?.normalize !== true) {
  console.error('Expected code embeddingIdentity.normalize=true in index_state.json.');
  process.exit(1);
}
if (proseState?.embeddings?.embeddingIdentity?.normalize !== true) {
  console.error('Expected prose embeddingIdentity.normalize=true in index_state.json.');
  process.exit(1);
}

const codeMetaPayload = JSON.parse(fs.readFileSync(codeMeta, 'utf8'));
const codeDocMetaPayload = JSON.parse(fs.readFileSync(codeDocMeta, 'utf8'));
const codeCodeMetaPayload = JSON.parse(fs.readFileSync(codeCodeMeta, 'utf8'));
const proseMetaPayload = JSON.parse(fs.readFileSync(proseMeta, 'utf8'));
const proseDocMetaPayload = JSON.parse(fs.readFileSync(proseDocMeta, 'utf8'));
const proseCodeMetaPayload = JSON.parse(fs.readFileSync(proseCodeMeta, 'utf8'));
if (codeMetaPayload.metric !== lanceConfig.metric) {
  console.error(`Expected LanceDB code metric=${lanceConfig.metric}, got ${codeMetaPayload.metric}`);
  process.exit(1);
}
if (codeDocMetaPayload.metric !== lanceConfig.metric) {
  console.error(`Expected LanceDB code/doc metric=${lanceConfig.metric}, got ${codeDocMetaPayload.metric}`);
  process.exit(1);
}
if (codeCodeMetaPayload.metric !== lanceConfig.metric) {
  console.error(`Expected LanceDB code/code metric=${lanceConfig.metric}, got ${codeCodeMetaPayload.metric}`);
  process.exit(1);
}
if (proseMetaPayload.metric !== lanceConfig.metric) {
  console.error(`Expected LanceDB prose metric=${lanceConfig.metric}, got ${proseMetaPayload.metric}`);
  process.exit(1);
}
if (proseDocMetaPayload.metric !== lanceConfig.metric) {
  console.error(`Expected LanceDB prose/doc metric=${lanceConfig.metric}, got ${proseDocMetaPayload.metric}`);
  process.exit(1);
}
if (proseCodeMetaPayload.metric !== lanceConfig.metric) {
  console.error(`Expected LanceDB prose/code metric=${lanceConfig.metric}, got ${proseCodeMetaPayload.metric}`);
  process.exit(1);
}

const searchResult = spawnSync(
  process.execPath,
  [
    path.join(root, 'search.js'),
    'index',
    '--backend',
    'memory',
    '--json',
    '--stats',
    '--ann',
    '--repo',
    repoRoot
  ],
  { cwd: repoRoot, env, encoding: 'utf8' }
);
if (searchResult.status !== 0) {
  console.error('search.js failed for LanceDB ANN test.');
  if (searchResult.stderr) console.error(searchResult.stderr.trim());
  process.exit(searchResult.status ?? 1);
}

const payload = JSON.parse(searchResult.stdout || '{}');
const stats = payload.stats || {};
if (stats.annBackend !== 'lancedb') {
  console.error(`Expected annBackend=lancedb, got ${stats.annBackend}`);
  process.exit(1);
}
if (!stats.annLance?.available?.code || !stats.annLance?.available?.prose) {
  console.error('Expected LanceDB availability for code and prose.');
  process.exit(1);
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
console.log('LanceDB ANN test passed');

