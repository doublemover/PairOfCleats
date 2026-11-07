import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildIndex } from '../../../../src/integrations/core/index.js';
import { getIndexDir, loadUserConfig, resolveSqlitePaths } from '../../../../tools/shared/dict-utils.js';
import { hasChunkMetaArtifactsSync } from '../../../../src/shared/artifact-io/chunk-meta-presence.js';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';
import { runNode } from '../../../helpers/run-node.js';
import { formatCommandFailure } from '../../../helpers/command-failure.js';
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

const assertIndexBudget = timeoutMs => assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 20000,
  'summary index controls may tighten, never raise, the existing 20-second limit');

const buildSummaryCoreIndex = async ({ repoRoot, env, indexer = buildIndex, timeoutMs = 20000 }) => {
  assertIndexBudget(timeoutMs);
  const controller = new AbortController();
  const deadline = Object.assign(new Error(`Summary index exceeded ${timeoutMs}ms`), { code: 'ETIMEDOUT' });
  const timer = setTimeout(() => controller.abort(deadline), timeoutMs);
  // Reproduce a child environment exactly, including absent fixture overrides.
  const overrides = { ...Object.fromEntries(Object.keys(process.env)
    .filter(key => key.startsWith('PAIROFCLEATS_') && !Object.hasOwn(env, key))
    .map(key => [key, undefined])), ...env };
  try {
    await withTemporaryEnv(overrides, () => indexer(repoRoot, {
      mode: 'all', modes: ['code', 'prose'], stage: 'stage1', 'stub-embeddings': true,
      threads: 1, abortSignal: controller.signal
    }));
    if (controller.signal.aborted) throw deadline;
  } catch (error) {
    if (controller.signal.aborted && error !== deadline) throw Object.assign(deadline, { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const assertSummaryBuildCase = async ({ cacheVariant, sqliteMode, coreIndex = false,
  indexer = buildIndex, indexTimeoutMs = 20000 }) => {
  assert.ok(['repo', 'model'].includes(cacheVariant));
  assert.ok(Object.hasOwn(SQLITE_PATH_KEY, sqliteMode));
  assertIndexBudget(indexTimeoutMs);
  assert.ok(!coreIndex || sqliteMode === 'code', 'the focused core fixture builds its asserted code/prose inputs');
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
    if (coreIndex) {
      await buildSummaryCoreIndex({ repoRoot, env, indexer, timeoutMs: indexTimeoutMs });
    } else {
      const args = [path.join(ROOT, 'build_index.js'), '--stage', '1', '--stub-embeddings', '--repo', repoRoot];
      const result = runNode(args, `summary ${cacheVariant} index`, repoRoot, env,
        { stdio: 'pipe', timeoutMs: indexTimeoutMs, allowFailure: true });
      if (result.error || result.status !== 0) {
        throw Object.assign(new Error(formatCommandFailure({
          label: `summary ${cacheVariant} index`, command: [process.execPath, ...args].join(' '),
          cwd: repoRoot, result, maxLines: Number.MAX_SAFE_INTEGER
        })), { code: result.error?.code || 'ERR_SUMMARY_INDEX_FAILED' });
      }
    }

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
