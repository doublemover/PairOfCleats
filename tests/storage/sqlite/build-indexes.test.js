#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getIndexDir, loadUserConfig, resolveSqlitePaths } from '../../../tools/shared/dict-utils.js';
import { hasSqlite } from '../../helpers/optional-deps.js';
import { runNode } from '../../helpers/run-node.js';
import { skip } from '../../helpers/skip.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

if (!hasSqlite()) {
  skip('better-sqlite3 not available; skipping sqlite build indexes test.');
}

const { default: Database } = await import('better-sqlite3');
const root = process.cwd();
const { dir: tempRoot } = await prepareIsolatedTestCacheDir('sqlite-build-indexes', { root });
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const buildIndexPath = path.join(root, 'build_index.js');

try {
  await fsPromises.mkdir(repoRoot, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  await fsPromises.writeFile(path.join(repoRoot, 'alpha.js'), 'const alpha = 1;\n');
  await fsPromises.writeFile(path.join(repoRoot, 'beta.js'), 'const beta = 2;\n');

  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    syncProcess: false
  });

  runNode(
    [buildIndexPath, '--stub-embeddings', '--stage', 'stage2', '--mode', 'code', '--repo', repoRoot],
    'build_index',
    repoRoot,
    env
  );
  await runSqliteBuild(repoRoot, { mode: 'code', env });

  await withTemporaryEnv({
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_TESTING: '1'
  }, async () => {
    const userConfig = loadUserConfig(repoRoot);
    const indexDir = getIndexDir(repoRoot, 'code', userConfig);
    const chunkMetaPartsDir = path.join(indexDir, 'chunk_meta.parts');
    const tokenPostingsShardsDir = path.join(indexDir, 'token_postings.shards');
    const chunkMetaJson = path.join(indexDir, 'chunk_meta.json');
    const hasChunkMeta = fs.existsSync(chunkMetaJson) || fs.existsSync(chunkMetaPartsDir);
    if (!hasChunkMeta) {
      console.error(`Expected chunk metadata in ${chunkMetaJson} or ${chunkMetaPartsDir}`);
      process.exit(1);
    }
    const hasTokenPostings = fs.existsSync(tokenPostingsShardsDir)
      || fs.existsSync(path.join(indexDir, 'token_postings.json'));
    if (!hasTokenPostings) {
      console.error(`Expected token postings artifacts in ${tokenPostingsShardsDir}`);
      process.exit(1);
    }
    const sqlitePaths = resolveSqlitePaths(repoRoot, userConfig);
    const db = new Database(sqlitePaths.codePath);
    const indexList = db.prepare("PRAGMA index_list('token_postings')").all();
    const indexNames = new Set(indexList.map((row) => row.name));
    if (indexNames.has('idx_token_postings_token')) {
      console.error('Did not expect redundant idx_token_postings_token to exist');
      process.exit(1);
    }
    if (!indexList.some((row) => row.origin === 'pk')) {
      console.error('Expected token_postings PRIMARY KEY index to exist');
      process.exit(1);
    }
    const chunkIndexList = db.prepare("PRAGMA index_list('chunks')").all();
    const chunkIndexNames = new Set(chunkIndexList.map((row) => row.name));
    if (!chunkIndexNames.has('idx_chunks_file_id')) {
      console.error('Expected idx_chunks_file_id to exist');
      process.exit(1);
    }
    db.close();
  });

  console.log('sqlite build indexes test passed');
} finally {
  try {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  } catch {}
}
