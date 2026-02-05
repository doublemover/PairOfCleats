#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  initBuildState,
  updateBuildState,
  flushBuildState
} from '../../../src/index/build/build-state.js';

const parseArgs = () => {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
};

const args = parseArgs();
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
  const runRoot = path.join(benchRoot, label);
  await fs.rm(runRoot, { recursive: true, force: true });
  await fs.mkdir(runRoot, { recursive: true });
  await initBuildState({
    buildRoot: runRoot,
    buildId: `bench-${label}`,
    stage: 'bench',
    toolVersion: 'bench',
    signatureVersion: 1
  });

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

const formatThroughput = (durationMs) => (
  durationMs > 0 ? (updates / (durationMs / 1000)) : 0
);

const printResult = (result) => {
  const throughput = formatThroughput(result.durationMs);
  console.log(
    `[bench] ${result.label} updates=${updates} ms=${result.durationMs.toFixed(1)} ` +
    `throughput=${throughput.toFixed(1)}/s bytes=${result.bytes}`
  );
  return throughput;
};

const printDelta = (baseline, current, baselineThroughput, currentThroughput) => {
  const deltaMs = current.durationMs - baseline.durationMs;
  const deltaPct = baseline.durationMs > 0 ? (deltaMs / baseline.durationMs) * 100 : 0;
  const deltaThroughput = currentThroughput - baselineThroughput;
  const deltaBytes = current.bytes - baseline.bytes;
  console.log(
    `[bench] delta ms=${deltaMs.toFixed(1)} (${deltaPct.toFixed(1)}%) ` +
    `throughput=${currentThroughput.toFixed(1)}/s Δ=${deltaThroughput.toFixed(1)}/s ` +
    `bytes=${current.bytes} Δ=${deltaBytes}`
  );
};

let baseline = null;
let current = null;
let baselineThroughput = 0;
let currentThroughput = 0;

if (mode !== 'current') {
  baseline = await runOnce('baseline', { flushEach: true });
  baselineThroughput = printResult(baseline);
}

if (mode !== 'baseline') {
  current = await runOnce('current', { flushEach: false });
  currentThroughput = printResult(current);
}

if (baseline && current) {
  printDelta(baseline, current, baselineThroughput, currentThroughput);
}
