#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { setupIncrementalRepo } from '../../helpers/sqlite-incremental.js';

const { root, repoRoot, env, run, runCapture } = await setupIncrementalRepo({
  name: 'stage3-perf-observability'
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
    '--mode',
    'code',
    '--repo',
    repoRoot
  ],
  'stage3 build'
);

const output = `${stage3Result.stdout || ''}\n${stage3Result.stderr || ''}`;
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

console.log('stage3 embeddings perf observability test passed');
