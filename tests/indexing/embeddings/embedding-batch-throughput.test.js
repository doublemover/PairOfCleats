#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { runBatched } from '../../../tools/build/embeddings/embed.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const testEnv = applyTestEnv({ testing: '1' });

const texts = Array.from({ length: 100 }, (_, i) => `t${i}`);
let calls = 0;

const embed = async (batch) => {
  calls += 1;
  return batch.map(() => [0]);
};

await runBatched({ texts, batchSize: 10, embed });
const expectedCalls = Math.ceil(texts.length / 10);
if (calls !== expectedCalls) {
  console.error(`embedding batch throughput test failed: expected ${expectedCalls} calls, got ${calls}`);
  process.exit(1);
}

calls = 0;
await runBatched({ texts, batchSize: 1, embed });
if (calls !== texts.length) {
  console.error(`embedding batch throughput test failed: expected ${texts.length} calls for batchSize=1, got ${calls}`);
  process.exit(1);
}

const root = process.cwd();
const benchScript = path.join(root, 'tools', 'bench', 'embeddings', 'embedding-batch-throughput.js');
const result = spawnSync(
  process.execPath,
  [
    benchScript,
    '--providers', 'stub',
    '--batches', '25',
    '--texts', '100',
    '--dims', '8',
    '--stub-batch-ms', '5'
  ],
  {
    cwd: root,
    env: testEnv,
    encoding: 'utf8'
  }
);

if (result.status !== 0) {
  console.error(result.stdout || '');
  console.error(result.stderr || '');
  process.exit(result.status ?? 1);
}

const output = `${result.stdout || ''}\n${result.stderr || ''}`;
const throughputMatch = output.match(/throughput=([0-9]+(?:\.[0-9]+)?)\/s/);
assert.ok(throughputMatch, 'expected benchmark throughput output');
const callsMatch = output.match(/calls=([0-9]+)/);
assert.ok(callsMatch, 'expected benchmark embed call-count output');
const timingMatch = output.match(/timing=([a-z-]+)/);
assert.equal(timingMatch?.[1], 'stub-fixed', 'expected deterministic stub timing mode');

const throughput = Number(throughputMatch[1]);
const benchCalls = Number(callsMatch[1]);
const minThroughputRaw = Number(process.env.PAIROFCLEATS_TEST_EMBEDDING_MIN_THROUGHPUT);
const minThroughput = Number.isFinite(minThroughputRaw) && minThroughputRaw > 0
  ? minThroughputRaw
  : 4500;

assert.equal(benchCalls, 4, `expected batch=25 run to use exactly 4 embed calls, got ${benchCalls}`);
assert.ok(
  throughput >= minThroughput,
  `expected embedding throughput >= ${minThroughput}/s, got ${throughput}/s. Set PAIROFCLEATS_TEST_EMBEDDING_MIN_THROUGHPUT to tune.`
);

console.log('embedding batch throughput test passed');
