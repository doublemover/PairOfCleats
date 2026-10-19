import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getIndexDir, loadUserConfig, resolveSqlitePaths } from '../../../../tools/shared/dict-utils.js';
import { hasChunkMetaArtifactsSync } from '../../../../src/shared/artifact-io/chunk-meta-presence.js';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';
import { runNode } from '../../../helpers/run-node.js';
import { applyTestEnv, withTemporaryEnv } from '../../../helpers/test-env.js';
import { makeTempDir, rmDirRecursive } from '../../../helpers/temp.js';

const ROOT = process.cwd();
const SAMPLE = path.join(ROOT, 'tests', 'fixtures', 'sample');
const MODEL_ID = 'Xenova/all-MiniLM-L12-v2';
const SQLITE_PATH_KEY = {
  code: 'codePath',
  prose: 'prosePath',
  'extracted-prose': 'extractedProsePath',
  records: 'recordsPath'
};
const EXPECTED_CHUNKS = { code: 26, prose: 3, 'extracted-prose': 2 };

export const assertSummaryBuildCase = async ({ cacheVariant, sqliteMode }) => {
  assert.ok(['repo', 'model'].includes(cacheVariant));
  assert.ok(Object.hasOwn(SQLITE_PATH_KEY, sqliteMode));
  const tempRoot = await makeTempDir(`poc-summary-${cacheVariant}-${sqliteMode}-`);
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, cacheVariant === 'model' ? 'model-compare' : 'cache');
  try {
    await fsPromises.cp(SAMPLE, repoRoot, {
      recursive: true,
      filter: (source) => !['.testCache', '.testLogs'].includes(path.basename(source))
    });
    assert.equal(fs.existsSync(path.join(repoRoot, '.testCache')), false,
      'report fixture must copy source inputs without author caches');
    const env = applyTestEnv({ cacheRoot, embeddings: 'stub', syncProcess: false,
      extraEnv: {
        PAIROFCLEATS_TRUSTED_CONFIG: null,
        ...(cacheVariant === 'model' ? { PAIROFCLEATS_MODEL: MODEL_ID } : {})
      } });
    const localEnv = { ...env, PAIROFCLEATS_TRUSTED_CONFIG: undefined };
    runNode([
      path.join(ROOT, 'build_index.js'), '--stage', '1', '--stub-embeddings', '--repo', repoRoot
    ], `summary ${cacheVariant} index`, repoRoot, env, { stdio: 'pipe', timeoutMs: 20000 });

    await withTemporaryEnv(localEnv, async () => {
      const config = loadUserConfig(repoRoot);
      for (const mode of ['code', 'prose']) {
        assert.equal(hasChunkMetaArtifactsSync(getIndexDir(repoRoot, mode, config)), true,
          `${cacheVariant} build must publish ${mode} artifacts`);
      }
    });

    await runSqliteBuild(repoRoot, { mode: sqliteMode, env: localEnv, emitOutput: false });
    await withTemporaryEnv(localEnv, async () => {
      const config = loadUserConfig(repoRoot);
      const target = resolveSqlitePaths(repoRoot, config)[SQLITE_PATH_KEY[sqliteMode]];
      if (sqliteMode === 'records') {
        assert.equal(fs.existsSync(target), false, 'empty records produce a recorded zero-state skip');
        return;
      }
      assert.equal(fs.existsSync(target), true, `${sqliteMode} SQLite output must exist`);
      const db = new Database(target, { readonly: true });
      try {
        assert.equal(db.prepare('SELECT COUNT(*) AS total FROM chunks').get().total,
          EXPECTED_CHUNKS[sqliteMode], `${sqliteMode} mode keeps the original sample inputs`);
      } finally { db.close(); }
    });
  } finally {
    await rmDirRecursive(tempRoot);
  }
};
