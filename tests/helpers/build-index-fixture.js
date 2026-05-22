import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from './test-env.js';
import { runNode } from './run-node.js';

export const createStage1CodeBuildEnv = ({ cacheRoot }) => applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      typeInference: false,
      typeInferenceCrossFile: false
    },
    tooling: {
      autoEnableOnDetect: false,
      lsp: { enabled: false }
    }
  }
});

export const createCodeBuildNoEmbeddingsEnv = ({ cacheRoot, extraEnv = {} }) => applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      embeddings: {
        enabled: false,
        mode: 'off',
        lancedb: { enabled: false },
        hnsw: { enabled: false }
      }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off',
    ...extraEnv
  }
});

export const runStage1CodeBuildOrExit = async ({
  root,
  repoRoot,
  cwd = repoRoot,
  env,
  failureLabel = 'build_index',
  printCrashLog = false
}) => {
  const buildResult = runNode(
    [
      path.join(root, 'build_index.js'),
      '--stub-embeddings',
      '--stage',
      'stage1',
      '--mode',
      'code',
      '--repo',
      repoRoot
    ],
    failureLabel,
    cwd,
    env,
    {
      stdio: 'inherit',
      allowFailure: true
    }
  );
  if (buildResult.status === 0) return buildResult;
  if (buildResult.error) {
    console.error(`${failureLabel} spawn error:`, buildResult.error);
  }
  if (printCrashLog) {
    const crashLogPath = path.join(repoRoot, 'logs', 'index-crash.log');
    if (fs.existsSync(crashLogPath)) {
      const crashLog = await fsPromises.readFile(crashLogPath, 'utf8');
      const tail = crashLog.length > 2000 ? crashLog.slice(-2000) : crashLog;
      console.error(`${failureLabel} crash log (tail):\n${tail}`);
    }
  }
  console.error(`Failed: ${failureLabel}`);
  process.exit(buildResult.status ?? 1);
};

export const runStage2CodeNoSqliteBuild = ({
  root,
  repoRoot,
  env,
  progress = 'off'
}) => {
  const result = runNode(
    [
      path.join(root, 'build_index.js'),
      '--repo',
      repoRoot,
      '--stage',
      'stage2',
      '--mode',
      'code',
      '--stub-embeddings',
      '--no-sqlite',
      '--progress',
      progress
    ],
    'build_index',
    repoRoot,
    env,
    {
      stdio: 'pipe',
      allowFailure: true
    }
  );
  if (result.status !== 0) {
    throw new Error(`build_index failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }
  return result;
};
