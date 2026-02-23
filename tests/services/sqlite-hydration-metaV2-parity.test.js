#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { buildSqliteIndex } from '../../src/integrations/core/index.js';
import { loadChunkMeta } from '../../src/shared/artifact-io.js';
import { createSqliteHelpers } from '../../src/retrieval/sqlite-helpers.js';
import { getCurrentBuildInfo, getIndexDir, loadUserConfig } from '../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../helpers/test-env.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-hydration-metaV2-parity');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const sqliteOutDir = path.join(tempRoot, 'sqlite-out');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'docs'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.writeFile(path.join(repoRoot, 'docs', 'sample.pdf'), Buffer.from('phase17 parity pdf', 'utf8'));
await fsPromises.writeFile(path.join(repoRoot, 'docs', 'sample.docx'), Buffer.from('phase17 parity docx', 'utf8'));

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      treeSitter: { enabled: false },
      documentExtraction: { enabled: true }
    },
    sqlite: { use: true }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off',
    PAIROFCLEATS_TEST_STUB_PDF_EXTRACT: '1',
    PAIROFCLEATS_TEST_STUB_DOCX_EXTRACT: '1'
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--repo', repoRoot, '--mode', 'extracted-prose', '--stub-embeddings', '--no-sqlite'],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
assert.equal(buildResult.status, 0, 'expected extracted-prose artifact build to succeed');

const userConfig = loadUserConfig(repoRoot);
const buildInfo = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'extracted-prose' });
const indexRoot = buildInfo?.activeRoot || buildInfo?.buildRoot || null;
assert.ok(indexRoot, 'expected extracted-prose build root');

const indexDir = getIndexDir(repoRoot, 'extracted-prose', userConfig, { indexRoot });
const artifactRows = await loadChunkMeta(indexDir, { strict: false, includeCold: true });
const artifactDocRows = artifactRows.filter((row) => {
  const sourceType = row?.metaV2?.segment?.sourceType;
  return sourceType === 'pdf' || sourceType === 'docx';
});
assert.ok(artifactDocRows.length >= 2, 'expected extracted document rows in artifact chunk_meta');

const sqliteResult = await buildSqliteIndex(repoRoot, {
  mode: 'extracted-prose',
  out: sqliteOutDir,
  indexRoot,
  emitOutput: false,
  exitOnError: false
});
assert.equal(sqliteResult.ok, true, 'expected sqlite build to succeed');

const dbCandidates = [
  sqliteResult.outputPaths?.['extracted-prose'],
  sqliteResult.outPath,
  path.join(sqliteOutDir, 'index-extracted-prose.db')
].filter((value) => typeof value === 'string' && value.length > 0);
const dbPath = dbCandidates.find((candidate) => fs.existsSync(candidate)) || null;
assert.ok(dbPath, 'expected sqlite extracted-prose db output');

const db = new Database(dbPath, { readonly: true });
const helpers = createSqliteHelpers({
  getDb: (mode) => (mode === 'extracted-prose' ? db : null),
  postingsConfig: {
    enablePhraseNgrams: false,
    enableChargrams: false,
    chargramMinN: 3,
    chargramMaxN: 3
  },
  sqliteFtsWeights: [1, 1, 1, 1, 1, 1, 1],
  maxCandidates: 10,
  vectorExtension: {},
  vectorAnnConfigByMode: {},
  vectorAnnState: {
    code: { available: false },
    prose: { available: false },
    'extracted-prose': { available: false },
    records: { available: false }
  },
  queryVectorAnn: () => [],
  modelIdDefault: 'stub',
  fileChargramN: 3
});
const sqliteIndex = helpers.loadIndexFromSqlite('extracted-prose', {
  includeDense: false,
  includeMinhash: false,
  includeFilterIndex: false
});
db.close();

const sqliteRows = Array.isArray(sqliteIndex?.chunkMeta)
  ? sqliteIndex.chunkMeta.filter(Boolean)
  : [];
const sqliteDocRows = sqliteRows.filter((row) => {
  const sourceType = row?.metaV2?.segment?.sourceType;
  return sourceType === 'pdf' || sourceType === 'docx';
});
assert.ok(sqliteDocRows.length >= 2, 'expected extracted document rows in sqlite chunk hydration');

const segmentProjection = (row) => ({
  schemaVersion: row?.metaV2?.schemaVersion ?? null,
  sourceType: row?.metaV2?.segment?.sourceType ?? null,
  pageStart: row?.metaV2?.segment?.pageStart ?? null,
  pageEnd: row?.metaV2?.segment?.pageEnd ?? null,
  paragraphStart: row?.metaV2?.segment?.paragraphStart ?? null,
  paragraphEnd: row?.metaV2?.segment?.paragraphEnd ?? null,
  headingPath: row?.metaV2?.segment?.headingPath ?? null,
  windowIndex: row?.metaV2?.segment?.windowIndex ?? null,
  anchor: row?.metaV2?.segment?.anchor ?? null
});

for (const sourceType of ['pdf', 'docx']) {
  const artifactRow = artifactDocRows.find((row) => row?.metaV2?.segment?.sourceType === sourceType);
  assert.ok(artifactRow, `expected artifact ${sourceType} row`);
  const sqliteRow = sqliteDocRows.find((row) => row?.chunkUid === artifactRow?.chunkUid)
    || sqliteDocRows.find((row) => row?.metaV2?.segment?.sourceType === sourceType);
  assert.ok(sqliteRow, `expected sqlite ${sourceType} row`);
  assert.deepEqual(
    segmentProjection(sqliteRow),
    segmentProjection(artifactRow),
    `expected sqlite/artifact metaV2 parity for ${sourceType}`
  );
}

console.log('sqlite hydration metaV2 parity test passed');
