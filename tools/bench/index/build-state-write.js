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

const percentile = (values, pct) => {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * pct)));
  return sorted[idx];
};

const args = parseArgs();
const updates = Number(args.updates) || 200;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';
const benchRoot = args.root
  ? path.resolve(String(args.root))
  : path.join(process.cwd(), '.benchCache', 'build-state-write');
const jsonOnly = Boolean(args.json);
const outPath = args.out ? path.resolve(String(args.out)) : null;

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

  const timings = [];
  const updatedAtValues = new Set();
  const startTotal = performance.now();
  const pending = [];

  for (let i = 0; i < updates; i += 1) {
    const patch = { counts: { seq: i } };
    const start = performance.now();
    const promise = updateBuildState(runRoot, patch).then((state) => {
      const duration = performance.now() - start;
      timings.push(duration);
      if (state?.updatedAt) updatedAtValues.add(state.updatedAt);
      return state;
    });
    if (flushEach) {
      await flushBuildState(runRoot);
      await promise;
    } else {
      pending.push(promise);
    }
  }

  if (!flushEach) {
    await Promise.all(pending);
  }
  await flushBuildState(runRoot);

  const totalMs = performance.now() - startTotal;
  return {
    label,
    totalMs,
    timings,
    writeCount: updatedAtValues.size,
    updates
  };
};

const formatResult = (result, baseline = null) => {
  const p50 = percentile(result.timings, 0.5);
  const p95 = percentile(result.timings, 0.95);
  const parts = [
    `updates=${result.updates}`,
    `total=${result.totalMs.toFixed(1)}ms`,
    `p50=${p50.toFixed(2)}ms`,
    `p95=${p95.toFixed(2)}ms`,
    `writes=${result.writeCount}`
  ];
  if (baseline) {
    const delta = result.totalMs - baseline.totalMs;
    const pct = baseline.totalMs > 0 ? (delta / baseline.totalMs) * 100 : null;
    const writeDelta = result.writeCount - baseline.writeCount;
    parts.push(`delta=${delta.toFixed(1)}ms (${pct?.toFixed(1)}%)`);
    parts.push(`writeΔ=${writeDelta}`);
  }
  return { p50, p95, parts };
};

let baseline = null;
let current = null;
if (mode !== 'current') {
  baseline = await runOnce('baseline', { flushEach: true });
  const formatted = formatResult(baseline);
  if (!jsonOnly) {
    console.log(`[bench] baseline ${formatted.parts.join(' ')}`);
  }
}
if (mode !== 'baseline') {
  current = await runOnce('debounced', { flushEach: false });
  const formatted = formatResult(current, baseline);
  if (!jsonOnly) {
    console.log(`[bench] debounced ${formatted.parts.join(' ')}`);
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  updates,
  baseline: baseline
    ? {
      totalMs: baseline.totalMs,
      p50Ms: percentile(baseline.timings, 0.5),
      p95Ms: percentile(baseline.timings, 0.95),
      writes: baseline.writeCount
    }
    : null,
  current: current
    ? {
      label: 'debounced',
      totalMs: current.totalMs,
      p50Ms: percentile(current.timings, 0.5),
      p95Ms: percentile(current.timings, 0.95),
      writes: current.writeCount
    }
    : null
};
if (baseline && current) {
  summary.delta = {
    totalMs: current.totalMs - baseline.totalMs,
    p50Ms: percentile(current.timings, 0.5) - percentile(baseline.timings, 0.5),
    p95Ms: percentile(current.timings, 0.95) - percentile(baseline.timings, 0.95),
    writes: current.writeCount - baseline.writeCount
  };
}

if (outPath) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(summary, null, 2));
