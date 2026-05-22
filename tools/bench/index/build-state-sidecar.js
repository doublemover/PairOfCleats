#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  updateBuildState,
  flushBuildState
} from '../../../src/index/build/build-state.js';
import { parseSimpleBenchArgs } from '../shared.js';
import { prepareBuildStateBenchRun } from './build-state-shared.js';
import {
  printThroughputResult,
  runComparedThroughputBenchmarks
} from './throughput-compare.js';

const args = parseSimpleBenchArgs();
const updates = Number(args.updates) || 300;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const benchRoot = path.join(process.cwd(), '.benchCache', 'build-state-sidecar');
await fs.mkdir(benchRoot, { recursive: true });

const sumStateBytes = async (runRoot) => {
  const entries = await fs.readdir(runRoot, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith('build_state.')) continue;
    const stat = await fs.stat(path.join(runRoot, entry.name));
    total += stat.size;
  }
  return total;
};

const runOnce = async (label, { flushEach }) => {
  const runRoot = await prepareBuildStateBenchRun({ benchRoot, label });

  const start = performance.now();
  for (let i = 0; i < updates; i += 1) {
    await updateBuildState(runRoot, {
      counts: { seq: i },
      progress: { code: { processed: i } }
    });
    if (flushEach) {
      await flushBuildState(runRoot);
    }
  }
  await flushBuildState(runRoot);
  const durationMs = performance.now() - start;
  const bytes = await sumStateBytes(runRoot);
  return { label, durationMs, bytes };
};

await runComparedThroughputBenchmarks({
  mode,
  runBaseline: () => runOnce('baseline', { flushEach: true }),
  runCurrent: () => runOnce('current', { flushEach: false }),
  printResult: (result) => printThroughputResult(result, {
    itemLabel: 'updates',
    items: updates
  })
});
