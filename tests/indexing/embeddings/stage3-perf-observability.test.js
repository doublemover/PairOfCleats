#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { parseProgressEventLine } from '../../../src/shared/cli/progress-events.js';
import { parseEmbeddingsPerfLine } from '../../../tools/build/embeddings/perf-progress.js';
import { setupIncrementalRepo } from '../../helpers/sqlite-incremental.js';

const { root, repoRoot, env, run, runCapture } = await setupIncrementalRepo({
  name: 'stage3-perf-observability',
  fixtureBuilder: async repo => {
    await fs.writeFile(path.join(repo, 'alpha.js'), '/** Add values. */\nexport const add = (a, b) => a + b;\n');
    await fs.writeFile(path.join(repo, 'beta.js'), 'export function greet(name) { return `Hello ${name}`; }\n');
  },
  testConfig: { threads: 1, sqlite: { use: false }, tooling: { autoEnableOnDetect: false },
    indexing: { typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false,
      embeddings: { hnsw: { enabled: false }, lancedb: { enabled: false } } } }
});

const buildIndexPath = path.join(root, 'build_index.js');

run(
  [
    buildIndexPath,
    '--incremental',
    '--stub-embeddings',
    '--scm-provider',
    'none',
    '--stage',
    'stage2',
    '--no-sqlite',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ],
  'stage2 build',
  { cwd: repoRoot, env, stdio: 'inherit' }
);

const stage3Result = runCapture(
  [
    buildIndexPath,
    '--incremental',
    '--stub-embeddings',
    '--scm-provider',
    'none',
    '--stage',
    'stage3',
    '--progress',
    'jsonl',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ],
  'stage3 build'
);

const rawOutput = `${stage3Result.stdout || ''}\n${stage3Result.stderr || ''}`;
const logs = rawOutput.split(/\r?\n/).map(line => parseProgressEventLine(line)).filter(event => event?.event === 'log');
assert.ok(logs.length, 'canonical JSONL log events retain complete observability data');
const output = logs.map(event => event.message).join('\n');
assert.match(
  output,
  /\[embeddings\]\s+code:\s+perf_progress\s+.*files_total=\d+.*chunks_total=\d+.*elapsed_ms=\d+/,
  'expected stage3 perf_progress line with stable metrics'
);
assert.match(
  output,
  /\[embeddings\]\s+code:\s+perf_summary\s+.*files_done=\d+.*chunks_done=\d+.*embed_compute_ms=\d+/,
  'expected stage3 perf_summary line with stable metrics'
);

const summaries = output.split('\n').map(parseEmbeddingsPerfLine)
  .filter((line) => line?.kind === 'perf_summary');
assert.ok(summaries.length > 0);
for (const { metrics } of summaries) {
  assert.ok(metrics.texts_scheduled >= metrics.texts_resolved,
    'scheduled must account for all resolved work');
  assert.equal(metrics.work_remaining_tokens_estimate, 0);
  assert.equal(metrics.work_remaining_groups, 0);
  assert.equal(metrics.provider_active, 0);
  assert.equal(metrics.batch_pending_requests, 0);
  assert.ok(['default', 'scheduler', 'memory-pressure', 'low-pressure'].includes(metrics.writer_cap_reason));
}
console.log('stage3 embeddings perf observability test passed');
