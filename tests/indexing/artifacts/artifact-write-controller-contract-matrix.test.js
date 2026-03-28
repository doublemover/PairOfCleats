#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  resolveArtifactWriteConcurrency,
  resolveArtifactLaneConcurrency
} from '../../../src/index/build/artifacts.js';
import {
  resolveArtifactLaneConcurrencyWithMassive,
  resolveArtifactLaneConcurrencyWithUltraLight,
  resolveArtifactWorkClassConcurrency,
  selectMicroWriteBatch,
  selectTailWorkerWriteEntry
} from '../../../src/index/build/artifacts-write.js';
import { createArtifactWriter } from '../../../src/index/build/artifacts/writer.js';
import { recordArtifactMetricRow } from '../../../src/index/build/artifacts/write-telemetry.js';
import { loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const writeConcurrencyCases = [
  {
    label: 'low-volume defaults',
    actual: resolveArtifactWriteConcurrency({
      artifactConfig: {},
      totalWrites: 20,
      availableParallelism: 32
    }),
    expected: { cap: 16, override: false }
  },
  {
    label: 'high-volume defaults',
    actual: resolveArtifactWriteConcurrency({
      artifactConfig: {},
      totalWrites: 200,
      availableParallelism: 32
    }),
    expected: { cap: 32, override: false }
  },
  {
    label: 'wide-host high-volume defaults',
    actual: resolveArtifactWriteConcurrency({
      artifactConfig: {},
      totalWrites: 200,
      availableParallelism: 96
    }),
    expected: { cap: 48, override: false }
  },
  {
    label: 'cpu bound defaults',
    actual: resolveArtifactWriteConcurrency({
      artifactConfig: {},
      totalWrites: 200,
      availableParallelism: 6
    }),
    expected: { cap: 6, override: false }
  },
  {
    label: 'explicit override wins',
    actual: resolveArtifactWriteConcurrency({
      artifactConfig: { writeConcurrency: 8 },
      totalWrites: 200,
      availableParallelism: 32
    }),
    expected: { cap: 8, override: true }
  },
  {
    label: 'zero writes disable concurrency',
    actual: resolveArtifactWriteConcurrency({
      artifactConfig: {},
      totalWrites: 0,
      availableParallelism: 32
    }),
    expected: { cap: 0, override: false }
  }
];

for (const testCase of writeConcurrencyCases) {
  assert.deepEqual(testCase.actual, testCase.expected, `artifact write concurrency mismatch: ${testCase.label}`);
}

assert.throws(
  () => resolveArtifactWriteConcurrency({
    artifactConfig: { writeConcurrency: 100 },
    totalWrites: 12,
    availableParallelism: 32
  }),
  /writeConcurrency/,
  'expected invalid writeConcurrency override to throw'
);

const laneConcurrencyCases = [
  {
    label: 'all-light uses full concurrency',
    actual: resolveArtifactLaneConcurrency({
      writeConcurrency: 2,
      lightWrites: 10,
      heavyWrites: 0,
      hostConcurrency: 16
    }),
    expected: { heavyConcurrency: 0, lightConcurrency: 2 }
  },
  {
    label: 'light-only caps at available work',
    actual: resolveArtifactLaneConcurrency({
      writeConcurrency: 16,
      lightWrites: 3,
      heavyWrites: 0,
      hostConcurrency: 16
    }),
    expected: { heavyConcurrency: 0, lightConcurrency: 3 }
  },
  {
    label: 'mixed lanes split slots',
    actual: resolveArtifactLaneConcurrency({
      writeConcurrency: 8,
      lightWrites: 10,
      heavyWrites: 2,
      hostConcurrency: 16
    }),
    expected: { heavyConcurrency: 2, lightConcurrency: 6 }
  },
  {
    label: 'mixed lanes reserve light slots under heavy backlog',
    actual: resolveArtifactLaneConcurrency({
      writeConcurrency: 12,
      lightWrites: 10,
      heavyWrites: 40,
      hostConcurrency: 16
    }),
    expected: { heavyConcurrency: 8, lightConcurrency: 4 }
  },
  {
    label: 'heavy-only uses full concurrency',
    actual: resolveArtifactLaneConcurrency({
      writeConcurrency: 8,
      lightWrites: 0,
      heavyWrites: 12,
      hostConcurrency: 16
    }),
    expected: { heavyConcurrency: 8, lightConcurrency: 0 }
  },
  {
    label: 'heavy override wins',
    actual: resolveArtifactLaneConcurrency({
      writeConcurrency: 8,
      lightWrites: 7,
      heavyWrites: 7,
      heavyWriteConcurrencyOverride: 1,
      hostConcurrency: 16
    }),
    expected: { heavyConcurrency: 1, lightConcurrency: 7 }
  },
  {
    label: 'single slot keeps strict global cap',
    actual: resolveArtifactLaneConcurrency({
      writeConcurrency: 1,
      lightWrites: 1,
      heavyWrites: 1,
      heavyWriteConcurrencyOverride: 8,
      hostConcurrency: 16
    }),
    expected: { heavyConcurrency: 1, lightConcurrency: 0 }
  }
];

for (const testCase of laneConcurrencyCases) {
  assert.deepEqual(testCase.actual, testCase.expected, `artifact lane concurrency mismatch: ${testCase.label}`);
}

const massiveLaneCases = [
  {
    label: 'massive-only uses full concurrency',
    actual: resolveArtifactLaneConcurrencyWithMassive({
      writeConcurrency: 4,
      ultraLightWrites: 0,
      massiveWrites: 10,
      lightWrites: 0,
      heavyWrites: 0,
      hostConcurrency: 16
    }),
    expected: { ultraLightConcurrency: 0, massiveConcurrency: 4, lightConcurrency: 0, heavyConcurrency: 0 }
  },
  {
    label: 'massive coexists beside heavy backlog',
    actual: resolveArtifactLaneConcurrencyWithMassive({
      writeConcurrency: 8,
      ultraLightWrites: 0,
      massiveWrites: 10,
      lightWrites: 0,
      heavyWrites: 20,
      hostConcurrency: 16
    }),
    expected: { ultraLightConcurrency: 0, massiveConcurrency: 2, lightConcurrency: 0, heavyConcurrency: 6 }
  },
  {
    label: 'mixed queues preserve all reservations',
    actual: resolveArtifactLaneConcurrencyWithMassive({
      writeConcurrency: 10,
      ultraLightWrites: 2,
      massiveWrites: 6,
      lightWrites: 8,
      heavyWrites: 8,
      hostConcurrency: 16
    }),
    expected: { ultraLightConcurrency: 2, massiveConcurrency: 2, lightConcurrency: 2, heavyConcurrency: 4 }
  },
  {
    label: 'single slot prioritizes massive queue',
    actual: resolveArtifactLaneConcurrencyWithMassive({
      writeConcurrency: 1,
      ultraLightWrites: 0,
      massiveWrites: 5,
      lightWrites: 2,
      heavyWrites: 2,
      hostConcurrency: 16
    }),
    expected: { ultraLightConcurrency: 0, massiveConcurrency: 1, lightConcurrency: 0, heavyConcurrency: 0 }
  }
];

for (const testCase of massiveLaneCases) {
  assert.deepEqual(testCase.actual, testCase.expected, `massive lane concurrency mismatch: ${testCase.label}`);
}

const ultraLightCases = [
  {
    label: 'ultra-light-only uses full concurrency',
    actual: resolveArtifactLaneConcurrencyWithUltraLight({
      writeConcurrency: 4,
      ultraLightWrites: 10,
      lightWrites: 0,
      heavyWrites: 0,
      hostConcurrency: 16
    }),
    expected: { ultraLightConcurrency: 4, lightConcurrency: 0, heavyConcurrency: 0 }
  },
  {
    label: 'ultra-light reserves slots beside heavy backlog',
    actual: resolveArtifactLaneConcurrencyWithUltraLight({
      writeConcurrency: 8,
      ultraLightWrites: 5,
      lightWrites: 0,
      heavyWrites: 30,
      hostConcurrency: 16
    }),
    expected: { ultraLightConcurrency: 2, lightConcurrency: 0, heavyConcurrency: 6 }
  },
  {
    label: 'mixed queues stay balanced',
    actual: resolveArtifactLaneConcurrencyWithUltraLight({
      writeConcurrency: 6,
      ultraLightWrites: 3,
      lightWrites: 12,
      heavyWrites: 12,
      hostConcurrency: 16
    }),
    expected: { ultraLightConcurrency: 2, lightConcurrency: 2, heavyConcurrency: 2 }
  },
  {
    label: 'single slot prioritizes ultra-light queue',
    actual: resolveArtifactLaneConcurrencyWithUltraLight({
      writeConcurrency: 1,
      ultraLightWrites: 3,
      lightWrites: 0,
      heavyWrites: 6,
      hostConcurrency: 16
    }),
    expected: { ultraLightConcurrency: 1, lightConcurrency: 0, heavyConcurrency: 0 }
  }
];

for (const testCase of ultraLightCases) {
  assert.deepEqual(testCase.actual, testCase.expected, `ultra-light lane concurrency mismatch: ${testCase.label}`);
}

const workClassCases = [
  {
    label: 'explicit work-class overrides',
    actual: resolveArtifactWorkClassConcurrency({
      writeConcurrency: 9,
      smallWrites: 20,
      mediumWrites: 20,
      largeWrites: 20,
      smallConcurrencyOverride: 2,
      mediumConcurrencyOverride: 3,
      largeConcurrencyOverride: 4
    }),
    expected: { smallConcurrency: 2, mediumConcurrency: 3, largeConcurrency: 4 }
  },
  {
    label: 'overflow trimming preserves large writes',
    actual: resolveArtifactWorkClassConcurrency({
      writeConcurrency: 6,
      smallWrites: 2,
      mediumWrites: 10,
      largeWrites: 10,
      smallConcurrencyOverride: 4,
      mediumConcurrencyOverride: 4,
      largeConcurrencyOverride: 4
    }),
    expected: { smallConcurrency: 0, mediumConcurrency: 2, largeConcurrency: 4 }
  },
  {
    label: 'single class caps at available items',
    actual: resolveArtifactWorkClassConcurrency({
      writeConcurrency: 5,
      smallWrites: 3,
      mediumWrites: 0,
      largeWrites: 0
    }),
    expected: { smallConcurrency: 3, mediumConcurrency: 0, largeConcurrency: 0 }
  }
];

for (const testCase of workClassCases) {
  assert.deepEqual(testCase.actual, testCase.expected, `work-class concurrency mismatch: ${testCase.label}`);
}

const defaultBudgets = resolveArtifactWorkClassConcurrency({
  writeConcurrency: 8,
  smallWrites: 12,
  mediumWrites: 12,
  largeWrites: 20
});
assert.equal(
  defaultBudgets.smallConcurrency + defaultBudgets.mediumConcurrency + defaultBudgets.largeConcurrency,
  8,
  'expected default work-class budgets to match total writer concurrency'
);
assert.ok(defaultBudgets.largeConcurrency > 0, 'expected default work-class budgets to reserve large-class capacity');

const microQueue = [
  { estimatedBytes: 8 * 1024, prefetched: null, job: async () => {}, seq: 0, label: 'meta-a' },
  { estimatedBytes: 10 * 1024, prefetched: null, job: async () => {}, seq: 1, label: 'meta-b' },
  { estimatedBytes: 96 * 1024, prefetched: null, job: async () => {}, seq: 2, label: 'meta-c' }
];
const microBatch = selectMicroWriteBatch(microQueue, {
  maxEntries: 4,
  maxBytes: 40 * 1024,
  maxEntryBytes: 32 * 1024
});
assert.equal(microBatch.entries.length, 2, 'expected micro batch to coalesce head entries');
assert.equal(microBatch.estimatedBytes, 18 * 1024, 'expected coalesced batch bytes');
assert.equal(microQueue.length, 1, 'expected queue to retain non-coalesced tail entry');

const tailQueues = {
  massive: [
    { estimatedBytes: 200 * 1024 * 1024, priority: 10, seq: 5, label: 'massive-A' },
    { estimatedBytes: 120 * 1024 * 1024, priority: 11, seq: 6, label: 'massive-B' }
  ],
  heavy: [
    { estimatedBytes: 40 * 1024 * 1024, priority: 50, seq: 1, label: 'heavy-A' }
  ],
  light: [],
  ultraLight: []
};
const tailSelection = selectTailWorkerWriteEntry(tailQueues);
assert.equal(tailSelection?.laneName, 'massive', 'expected tail worker to pick highest predicted write cost');
assert.equal(tailSelection?.entry?.label, 'massive-A', 'expected deterministic tail selection');
assert.equal(tailQueues.massive.length, 1, 'expected selected tail entry to be removed from queue');

const configTempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-artifact-write-controller-matrix-'));
const configPath = path.join(configTempRoot, '.pairofcleats.json');
const writeConfig = async (value) => {
  await fs.writeFile(
    configPath,
    JSON.stringify({ indexing: { artifacts: { writeConcurrency: value } } }, null, 2),
    'utf8'
  );
};

try {
  await writeConfig(8);
  const valid = loadUserConfig(configTempRoot);
  assert.equal(valid?.indexing?.artifacts?.writeConcurrency, 8, 'expected valid writeConcurrency to load');

  for (const value of [0, 65, 1.5, 'many']) {
    let failed = false;
    await writeConfig(value);
    try {
      loadUserConfig(configTempRoot);
    } catch (error) {
      failed = true;
      assert.match(String(error?.message || ''), /writeConcurrency/, `expected writeConcurrency failure for ${JSON.stringify(value)}`);
    }
    assert.equal(failed, true, `expected invalid writeConcurrency to be rejected: ${JSON.stringify(value)}`);
  }
} finally {
  await fs.rm(configTempRoot, { recursive: true, force: true });
}

applyTestEnv({ testing: '1' });

const writerOutDir = resolveTestCachePath(process.cwd(), 'artifact-write-controller-matrix-heuristics');
const writes = [];
const writer = createArtifactWriter({
  outDir: writerOutDir,
  enqueueWrite: (label, job, meta = {}) => {
    writes.push({ label, job, meta });
  },
  addPieceFile: () => {},
  formatArtifactLabel: (filePath) => path.relative(writerOutDir, filePath).replace(/\\/g, '/'),
  compressionEnabled: true,
  compressionMode: 'gzip',
  compressionKeepRaw: false,
  compressionGzipOptions: null,
  compressionMinBytes: 1024,
  compressionMaxBytes: 128 * 1024 * 1024,
  compressibleArtifacts: new Set(['tiny', 'normal', 'huge', 'arr']),
  compressionOverrides: {},
  jsonArraySerializeShardThresholdMs: 1,
  jsonArraySerializeShardMaxBytes: 64 * 1024
});

writer.enqueueJsonArray('tiny', [{ a: 1 }], {
  compressible: true,
  estimatedBytes: 256
});
assert.ok(writes.at(-1)?.label?.endsWith('tiny.json'));

writer.enqueueJsonArray('normal', Array.from({ length: 256 }, (_, index) => ({ index, text: 'x'.repeat(64) })), {
  compressible: true,
  estimatedBytes: 512 * 1024
});
assert.ok(writes.at(-1)?.label?.endsWith('normal.json.gz'));

writer.enqueueJsonArray('huge', [{ a: 1 }], {
  compressible: true,
  estimatedBytes: 1024 * 1024 * 1024
});
assert.ok(writes.at(-1)?.label?.endsWith('huge.json'));

const marker = writes.length;
writer.enqueueJsonArraySharded(
  'arr',
  Array.from({ length: 2000 }, (_, index) => ({ index, text: 'y'.repeat(80) })),
  {
    maxBytes: 0,
    estimatedBytes: 4 * 1024 * 1024,
    piece: { type: 'chunks', name: 'arr' }
  }
);
assert.equal(writes.slice(marker).some((entry) => entry.label.endsWith('arr.parts')), true);

const fallbackMarker = writes.length;
writer.enqueueJsonArraySharded(
  'arr-fallback',
  [{ index: 1, text: 'z'.repeat(16) }],
  {
    maxBytes: 8 * 1024 * 1024,
    estimatedBytes: 1024,
    piece: { type: 'chunks', name: 'arr-fallback' }
  }
);
assert.equal(writes[fallbackMarker]?.meta?.estimatedBytes, 1024);

const artifactMetrics = new Map();
const artifactQueueDelaySamples = new Map();
recordArtifactMetricRow({
  label: 'chunk_meta.binary-columnar.bundle',
  metric: {
    queueDelayMs: 5,
    durationMs: 40,
    phaseTimings: {
      serializationMs: 7,
      flushMs: 11,
      fsyncMs: 13,
      publishMs: 17,
      backpressureWaitMs: 19
    }
  },
  artifactMetrics,
  artifactQueueDelaySamples
});

const metric = artifactMetrics.get('chunk_meta.binary-columnar.bundle');
assert.ok(metric, 'expected metric row to be recorded');
assert.ok(metric.phaseTimings && typeof metric.phaseTimings === 'object');
assert.equal(metric.serializationMs, 7);
assert.equal(metric.flushMs, 11);
assert.equal(metric.fsyncMs, 13);
assert.equal(metric.publishMs, 17);
assert.equal(metric.backpressureWaitMs, 19);
assert.equal(metric.diskMs, 41);

console.log('artifact write controller contract matrix test passed');
