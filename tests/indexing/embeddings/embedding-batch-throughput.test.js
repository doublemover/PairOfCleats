#!/usr/bin/env node
import { runBatched } from '../../../tools/build/embeddings/embed.js';

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

console.log('embedding batch throughput test passed');
