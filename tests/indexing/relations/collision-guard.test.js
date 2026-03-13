#!/usr/bin/env node
import { createRowSpillCollector } from '../../../src/index/build/artifacts/helpers.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const collector = createRowSpillCollector({
  compare: (a, b) => stableStringify(a).localeCompare(stableStringify(b))
});

await collector.append({ edge: 1 }, { dedupeHash: 'h', dedupeFingerprint: 'a' });
await collector.append({ edge: 2 }, { dedupeHash: 'h', dedupeFingerprint: 'b' });
await collector.append({ edge: 1 }, { dedupeHash: 'h', dedupeFingerprint: 'a' }); // dup

const finalized = await collector.finalize();
const rows = finalized?.rows || [];
const stats = finalized?.stats || collector.stats;

if (rows.length !== 2) {
  fail(`relations collision guard test failed: expected 2 rows, got ${rows.length}.`);
}
if (!stats || typeof stats !== 'object') {
  fail('relations collision guard test failed: missing stats.');
}
if (stats.dedupeCollisions !== 1) {
  fail(`relations collision guard test failed: expected dedupeCollisions=1, got ${stats.dedupeCollisions}.`);
}
if (stats.dedupedRows !== 1) {
  fail(`relations collision guard test failed: expected dedupedRows=1, got ${stats.dedupedRows}.`);
}

console.log('relations collision guard test passed');

