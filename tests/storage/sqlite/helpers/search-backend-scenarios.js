import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../../helpers/test-env.js';
import { runNode } from '../../../helpers/run-node.js';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';
import { resolveSqlitePaths } from '../../../../tools/shared/dict-utils.js';

const root = process.cwd();

export const createSearchBackendFixture = async (name) => {
  const tempRoot = resolveTestCachePath(root, name);
  const cacheRoot = path.join(tempRoot, '.cache');
  const snapshotRoot = path.join(tempRoot, '.sqlite-snapshot');
  const searchPath = path.join(root, 'search.js');
  const buildIndexPath = path.join(root, 'build_index.js');

  await fsPromises.rm(tempRoot, { recursive: true, force: true });
  await fsPromises.mkdir(tempRoot, { recursive: true });

  await fsPromises.writeFile(
    path.join(tempRoot, 'sample.js'),
    [
      'export function greet(name) {',
      '  return "hello " + name;',
      '}',
      ''
    ].join('\n'),
    'utf8'
  );

  const buildTestEnv = (testConfig = null, extraEnv = {}) => applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: testConfig ?? {
      indexing: {
        scm: { provider: 'none' },
        typeInference: false,
        typeInferenceCrossFile: false,
        riskAnalysis: false,
        riskAnalysisCrossFile: false
      },
      tooling: {
        autoEnableOnDetect: false,
        lsp: { enabled: false }
      }
    },
    extraEnv: {
      PAIROFCLEATS_WORKER_POOL: 'off',
      ...extraEnv
    }
  });

  const run = (args, label, { testConfig = null, extraEnv = {}, allowFailure = false } = {}) => {
    const result = runNode(args, label, tempRoot, buildTestEnv(testConfig, extraEnv), {
      stdio: 'pipe',
      encoding: 'utf8',
      allowFailure: true
    });
    if (result.status !== 0 && !allowFailure) {
      console.error(`Failed: ${label}`);
      if (result.stderr) console.error(result.stderr.trim());
      process.exit(result.status ?? 1);
    }
    return result;
  };

  run([buildIndexPath, '--stub-embeddings', '--stage', 'stage1', '--mode', 'code', '--repo', tempRoot], 'build index');
  await runSqliteBuild(tempRoot, { mode: 'code' });
  const initialSqlitePaths = resolveSqlitePaths(tempRoot, null);
  await fsPromises.rm(snapshotRoot, { recursive: true, force: true });
  await fsPromises.cp(initialSqlitePaths.dbDir, snapshotRoot, { recursive: true });

  return {
    tempRoot,
    snapshotRoot,
    searchPath,
    run,
    resolveSqlitePaths: () => resolveSqlitePaths(tempRoot, null),
    restoreSnapshot: async () => {
      const sqlitePaths = resolveSqlitePaths(tempRoot, null);
      await fsPromises.cp(snapshotRoot, sqlitePaths.dbDir, { recursive: true });
    }
  };
};

export const parseJsonPayload = (result) => JSON.parse(result.stdout || '{}');
