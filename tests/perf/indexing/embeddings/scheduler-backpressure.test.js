#!/usr/bin/env node
import fsSync from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseBuildEmbeddingsArgs } from '../../../../tools/build/embeddings/cli.js';
import { runBuildEmbeddingsWithConfig } from '../../../../tools/build/embeddings/runner.js';
import { SCHEDULER_QUEUE_NAMES } from '../../../../src/index/build/runtime/scheduler.js';
import {
  getCurrentBuildInfo,
  getRepoCacheRoot,
  loadUserConfig
} from '../../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'embeddings-scheduler-backpressure');
const repoRoot = path.join(tempRoot, 'repo');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.writeFile(path.join(repoRoot, 'index.js'), 'export const answer = 42;\n');

applyTestEnv({
  cacheRoot: tempRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scheduler: {
        enabled: true,
        lowResourceMode: false,
        cpuTokens: 1,
        ioTokens: 1,
        memoryTokens: 1,
        queues: {
          [SCHEDULER_QUEUE_NAMES.embeddingsCompute]: { maxPending: 4 },
          [SCHEDULER_QUEUE_NAMES.embeddingsIo]: { maxPending: 4 }
        }
      },
      scm: { provider: 'none' },
      embeddings: {
        enabled: true,
        mode: 'stub',
        hnsw: { enabled: false },
        lancedb: { enabled: false }
      },
      treeSitter: { enabled: false },
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false
    }
  },
  extraEnv: {
    PAIROFCLEATS_SCHEDULER: '1',
    PAIROFCLEATS_SCHEDULER_CPU: '1',
    PAIROFCLEATS_SCHEDULER_IO: '1',
    PAIROFCLEATS_SCHEDULER_MEM: '1'
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env: process.env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('embeddings scheduler backpressure test failed: build_index failed');
  process.exit(buildResult.status ?? 1);
}

// Clear both modern (versioned) and legacy cache locations so this run cannot
// bypass scheduler queues via cache hits, but keep stage2 index artifacts intact.
const userConfig = loadUserConfig(repoRoot);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
await fsPromises.rm(path.join(repoCacheRoot, 'embeddings'), { recursive: true, force: true });
await fsPromises.rm(path.join(tempRoot, 'embeddings'), { recursive: true, force: true });
const resolveActiveBuildRoot = async () => {
  const current = getCurrentBuildInfo(repoRoot, userConfig);
  const directCandidates = [
    current?.activeRoot || null,
    current?.buildRoot || null,
    current?.buildId ? path.join(repoCacheRoot, 'builds', current.buildId) : null
  ].filter((value, index, array) => (
    typeof value === 'string'
    && value.length > 0
    && array.indexOf(value) === index
  ));
  for (const candidate of directCandidates) {
    const codeDir = path.join(candidate, 'index-code');
    if (fsSync.existsSync(codeDir)) return candidate;
  }
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  let entries = [];
  try {
    entries = await fsPromises.readdir(buildsRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const dirs = [];
  for (const entry of entries) {
    if (!entry?.isDirectory?.()) continue;
    const buildRoot = path.join(buildsRoot, entry.name);
    const codeDir = path.join(buildRoot, 'index-code');
    if (!fsSync.existsSync(codeDir)) continue;
    try {
      const stat = await fsPromises.stat(buildRoot);
      dirs.push({ buildRoot, mtimeMs: Number(stat.mtimeMs) || 0 });
    } catch {
      dirs.push({ buildRoot, mtimeMs: 0 });
    }
  }
  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirs[0]?.buildRoot || null;
};

const activeBuildRoot = await resolveActiveBuildRoot();
if (!activeBuildRoot) {
  console.error('embeddings scheduler backpressure test failed: missing active build root');
  process.exit(1);
}

const config = parseBuildEmbeddingsArgs([
  '--stub-embeddings',
  '--mode',
  'code',
  '--repo',
  repoRoot,
  '--index-root',
  activeBuildRoot
]);
const result = await runBuildEmbeddingsWithConfig(config);
const stats = result?.scheduler;
if (!stats || !stats.queues) {
  console.error('embeddings scheduler backpressure test failed: scheduler stats missing');
  process.exit(1);
}
const computeQueue = stats.queues[SCHEDULER_QUEUE_NAMES.embeddingsCompute];
const ioQueue = stats.queues[SCHEDULER_QUEUE_NAMES.embeddingsIo];
const computeScheduled = Number(computeQueue?.scheduled || 0);
const ioScheduled = Number(ioQueue?.scheduled || 0);
if (computeScheduled <= 0 && ioScheduled <= 0) {
  console.error('embeddings scheduler backpressure test failed: scheduler queues missing scheduled work');
  process.exit(1);
}
if (ioScheduled <= 0) {
  console.error('embeddings scheduler backpressure test failed: IO queue missing scheduled work');
  process.exit(1);
}

console.log('embeddings scheduler backpressure test passed');
