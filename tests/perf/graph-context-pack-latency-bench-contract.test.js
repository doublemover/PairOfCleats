#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { applyTestEnv } from '../helpers/test-env.js';
import { createGraphBenchFixture, runGraphBenchCompare } from './helpers/graph-bench-fixture.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const { indexDir, repoRoot } = await createGraphBenchFixture({
  tempLabel: 'graph-context-pack-latency-bench-contract',
  repoText: [
    'export function foo() {',
    '  return 1;',
    '}',
    ''
  ].join('\n'),
  chunkEndLine: 3
});

const bench = runGraphBenchCompare({
  benchScript: path.join(root, 'tools', 'bench', 'graph', 'context-pack-latency.js'),
  indexDir,
  repoRoot
});

assert.equal(bench.mode, 'compare');
assert.ok(bench.baseline && bench.current, 'expected baseline and current results');
assert.ok(bench.meta?.timings?.graphIndexColdMs >= 0, 'expected graphIndex timing metadata');
assert.ok(bench.meta?.graphStore?.cache?.index, 'expected graphStore cache stats');

assert.ok(bench.baseline.throughput > 0, 'expected baseline throughput');
assert.ok(bench.current.throughput > 0, 'expected current throughput');
assert.ok(
  bench.current.throughput > bench.baseline.throughput,
  'expected current to outperform baseline in the same run'
);

console.log('graph context-pack latency bench contract test passed');

