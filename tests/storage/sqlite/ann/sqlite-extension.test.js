#!/usr/bin/env node
import { applyTestEnv } from '../../../helpers/test-env.js';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadUserConfig, resolveSqlitePaths } from '../../../../tools/shared/dict-utils.js';
import {
  getVectorExtensionConfig,
  resolveVectorExtensionConfigForMode
} from '../../../../tools/sqlite/vector-extension.js';
import { requireSqliteVec } from '../../../helpers/optional-deps.js';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-ann-extension');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'index.js'),
  [
    'export function annPrimary() {',
    '  return "index token";',
    '}',
    ''
  ].join('\n'),
  'utf8'
);
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'secondary.js'),
  [
    'export const annSecondary = "sqlite extension vector token";',
    ''
  ].join('\n'),
  'utf8'
);

const deletableFile = path.join(repoRoot, 'src', 'ann_deletable.js');
await fsPromises.writeFile(
  deletableFile,
  'export const annDeletable = "ann_deletable_token";\n'
);

const extensionPath = requireSqliteVec({ repoRoot });

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false
    },
    sqlite: {
      vectorExtension: {
        annMode: 'extension',
        enabled: true,
        path: extensionPath
      }
    },
    tooling: {
      autoEnableOnDetect: false,
      lsp: { enabled: false }
    }
  },
  extraEnv: { PAIROFCLEATS_BUNDLE_THREADS: '1' }
});

function run(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

const runEmbeddings = (label) => run(
  [
    path.join(root, 'tools', 'build', 'embeddings.js'),
    '--stub-embeddings',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ],
  label
);

run(
  [
    path.join(root, 'build_index.js'),
    '--incremental',
    '--stage',
    'stage1',
    '--stub-embeddings',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ],
  'build index'
);
runEmbeddings('build embeddings');
await runSqliteBuild(repoRoot, { mode: 'code' });

const userConfig = loadUserConfig(repoRoot);
const sqlitePaths = resolveSqlitePaths(repoRoot, userConfig);
const sqliteSharedDb = Boolean(
  sqlitePaths?.codePath
  && sqlitePaths?.prosePath
  && path.resolve(sqlitePaths.codePath) === path.resolve(sqlitePaths.prosePath)
);
const vectorExtension = getVectorExtensionConfig(repoRoot, userConfig);
const codeVectorExtension = resolveVectorExtensionConfigForMode(vectorExtension, 'code', {
  sharedDb: sqliteSharedDb
});
const annTableName = codeVectorExtension?.table || 'dense_vectors_ann';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.error('better-sqlite3 is required for sqlite-ann-extension test.');
  process.exit(1);
}

const db = new Database(sqlitePaths.codePath, { readonly: true });
try {
  db.loadExtension(extensionPath);
} catch (err) {
  console.error(`Failed to load sqlite ann extension for verification: ${err?.message || err}`);
  process.exit(1);
}
const table = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
).get(annTableName);
if (!table) {
  console.error(`sqlite ann extension table missing: ${annTableName}`);
  process.exit(1);
}
const countRow = db.prepare(`SELECT COUNT(*) AS count FROM ${annTableName}`).get();
if (!countRow?.count) {
  console.error(`sqlite ann extension table empty: ${annTableName}`);
  process.exit(1);
}
const denseCountBefore = db.prepare(
  'SELECT COUNT(*) AS count FROM dense_vectors WHERE mode = ?'
).get('code');
const annCountBefore = countRow.count;
db.close();

const searchResult = spawnSync(
  process.execPath,
  [
    path.join(root, 'search.js'),
    'index',
    '--json',
    '--stats',
    '--mode',
    'code',
    '--ann',
    '--ann-backend',
    'sqlite-extension',
    '--repo',
    repoRoot
  ],
  { cwd: repoRoot, env, encoding: 'utf8' }
);
if (searchResult.status !== 0) {
  console.error('search.js failed for sqlite ann extension test.');
  if (searchResult.stderr) console.error(searchResult.stderr.trim());
  process.exit(searchResult.status ?? 1);
}

const payload = JSON.parse(searchResult.stdout || '{}');
const stats = payload.stats || {};
if (stats.annBackend !== 'sqlite-extension') {
  console.error(`Expected annBackend=sqlite-extension, got ${stats.annBackend}`);
  process.exit(1);
}
if (stats.annMode !== 'extension') {
  console.error(`Expected annMode=extension, got ${stats.annMode}`);
  process.exit(1);
}
if (!stats.annExtension?.available?.code) {
  console.error('Expected sqlite ann extension available for code.');
  process.exit(1);
}

await fsPromises.rm(deletableFile, { force: true });
run(
  [
    path.join(root, 'build_index.js'),
    '--incremental',
    '--stage',
    'stage1',
    '--stub-embeddings',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ],
  'build index (incremental)'
);
runEmbeddings('build embeddings (incremental)');
await runSqliteBuild(repoRoot, { mode: 'code', incremental: true });

const sqlitePathsAfter = resolveSqlitePaths(repoRoot, userConfig);
const dbAfter = new Database(sqlitePathsAfter.codePath, { readonly: true });
try {
  dbAfter.loadExtension(extensionPath);
} catch (err) {
  console.error(`Failed to load sqlite ann extension for incremental verification: ${err?.message || err}`);
  process.exit(1);
}
const denseCountAfter = dbAfter.prepare(
  'SELECT COUNT(*) AS count FROM dense_vectors WHERE mode = ?'
).get('code');
const annCountAfter = dbAfter.prepare(
  `SELECT COUNT(*) AS count FROM ${annTableName}`
).get()?.count;
if (Number(annCountAfter) !== Number(denseCountAfter?.count)) {
  console.error(`Dense vector count mismatch after incremental update: dense=${denseCountAfter?.count} ann=${annCountAfter}`);
  process.exit(1);
}
if (denseCountBefore?.count && denseCountAfter?.count >= denseCountBefore.count) {
  console.error('Expected dense vector count to drop after deletion.');
  process.exit(1);
}
const orphanRow = dbAfter.prepare(
  `SELECT COUNT(*) AS count FROM ${annTableName} WHERE rowid NOT IN (SELECT doc_id FROM dense_vectors WHERE mode = ?)`
).get('code');
if (orphanRow?.count) {
  console.error(`Found ${orphanRow.count} orphaned ann rows after deletion.`);
  process.exit(1);
}
dbAfter.close();

console.log('sqlite ann extension test passed');
