#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { parseBuildArgs } from '../../../../src/index/build/args.js';
import { buildIndexForMode } from '../../../../src/index/build/indexer.js';
import { createBuildRuntime } from '../../../../src/index/build/runtime.js';
import { SCHEDULER_QUEUE_NAMES } from '../../../../src/index/build/runtime/scheduler.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'scheduler-stage-wiring');
const repoRoot = path.join(tempRoot, 'repo');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.writeFile(path.join(repoRoot, 'index.js'), 'export const answer = 42;\n');

applyTestEnv({
  cacheRoot: tempRoot,
  embeddings: 'off',
  testConfig: {
    indexing: {
      scheduler: {
        enabled: true,
        lowResourceMode: false,
        cpuTokens: 1,
        ioTokens: 1,
        memoryTokens: 1,
        queueDepthSnapshotIntervalMs: 1000
      },
      hugeRepoProfile: { enabled: true },
      scm: { provider: 'none' },
      embeddings: {
        enabled: false,
        hnsw: { enabled: false },
        lancedb: { enabled: false }
      },
      treeSitter: { enabled: false },
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false
    }
  }
});

const defaults = parseBuildArgs([]).argv;
const argv = { ...defaults, stage: 'stage2' };
const runtime = await createBuildRuntime({ root: repoRoot, argv, rawArgv: [] });

await buildIndexForMode({ mode: 'code', runtime, discovery: null, abortSignal: null });

const stats = runtime.scheduler?.stats ? runtime.scheduler.stats() : null;
if (!stats || !stats.queues) {
  console.error('scheduler stats missing after build');
  process.exit(1);
}
const telemetry = stats?.telemetry || null;
if (!telemetry || !Array.isArray(telemetry.schedulingTrace) || telemetry.schedulingTrace.length === 0) {
  console.error('scheduler stage wiring test failed: missing scheduling traces');
  process.exit(1);
}
if (!Array.isArray(telemetry.queueDepthSnapshots) || telemetry.queueDepthSnapshots.length === 0) {
  console.error('scheduler stage wiring test failed: missing queue-depth snapshots');
  process.exit(1);
}
const hasStagedSnapshot = telemetry.queueDepthSnapshots.some((entry) => (
  typeof entry?.stage === 'string' && entry.stage.length > 0
));
if (!hasStagedSnapshot) {
  console.error('scheduler stage wiring test failed: queue-depth snapshots missing stage labels');
  process.exit(1);
}
const queues = stats.queues;
const expectQueue = (queueName) => {
  const entry = queues[queueName];
  if (!entry || !Number.isFinite(entry.scheduled) || entry.scheduled <= 0) {
    console.error(`scheduler queue ${queueName} missing scheduled work`);
    process.exit(1);
  }
};

expectQueue(SCHEDULER_QUEUE_NAMES.stage1Cpu);
expectQueue(SCHEDULER_QUEUE_NAMES.stage1Postings);
expectQueue(SCHEDULER_QUEUE_NAMES.stage2Relations);

console.log('scheduler stage wiring test passed');
