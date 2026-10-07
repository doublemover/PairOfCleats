#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadUserConfig, getIndexDir } from '../../shared/dict-utils.js';
import { MAX_JSON_BYTES } from '../../../src/shared/artifact-io/constants.js';
import { loadChunkMeta } from '../../../src/shared/artifact-io/loaders.js';
import { exitLikeChild } from '../../../src/tui/wrapper-exit.js';
import { spawnSubprocessSync } from '../../../src/shared/subprocess/runner.js';
import { parseSimpleBenchArgs } from '../shared.js';

const args = parseSimpleBenchArgs();
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';
const repoRoot = args.repo
  ? path.resolve(String(args.repo))
  : path.join(process.cwd(), 'tests', 'fixtures', 'medium');
const benchRoot = args.root
  ? path.resolve(String(args.root))
  : path.join(process.cwd(), '.benchCache', 'scheduler-build');

const runOnce = async (label, schedulerEnabled) => {
  const runRoot = path.join(benchRoot, label);
  await fs.rm(runRoot, { recursive: true, force: true });
  await fs.mkdir(runRoot, { recursive: true });
  const env = {
    ...process.env,
    PAIROFCLEATS_CACHE_ROOT: runRoot,
    PAIROFCLEATS_SCHEDULER: schedulerEnabled ? '1' : '0'
  };
  const args = [
    path.join(process.cwd(), 'build_index.js'),
    '--stub-embeddings',
    '--scm-provider',
    'none',
    '--repo',
    repoRoot,
    '--quiet'
  ];
  const start = performance.now();
  const result = spawnSubprocessSync(process.execPath, args, {
    env,
    cwd: repoRoot,
    stdio: 'inherit',
    rejectOnNonZeroExit: false,
    killTree: true,
    detached: process.platform !== 'win32'
  });
  if (result.exitCode !== 0) {
    console.error(`[bench] build_index failed for ${label}`);
    exitLikeChild({ status: result.exitCode, signal: result.signal });
  }
  const totalMs = performance.now() - start;
  const userConfig = loadUserConfig(repoRoot);
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  let chunkCount = 0;
  try {
    const chunkMeta = await loadChunkMeta(codeDir, { maxBytes: MAX_JSON_BYTES });
    chunkCount = Array.isArray(chunkMeta) ? chunkMeta.length : 0;
  } catch {}
  return { label, totalMs, chunkCount };
};

const formatResult = (result, baseline = null) => {
  const throughput = result.totalMs > 0
    ? (result.chunkCount / (result.totalMs / 1000))
    : 0;
  const parts = [
    `chunks=${result.chunkCount}`,
    `total=${result.totalMs.toFixed(1)}ms`,
    `throughput=${throughput.toFixed(2)} chunks/s`
  ];
  if (baseline) {
    const delta = result.totalMs - baseline.totalMs;
    const pct = baseline.totalMs > 0 ? (delta / baseline.totalMs) * 100 : 0;
    const throughputDelta = throughput - (baseline.totalMs > 0
      ? (baseline.chunkCount / (baseline.totalMs / 1000))
      : 0);
    parts.push(`delta=${delta.toFixed(1)}ms (${pct.toFixed(1)}%)`);
    parts.push(`throughputΔ=${throughputDelta.toFixed(2)} chunks/s`);
  }
  return parts.join(' ');
};

let baseline = null;
let current = null;
if (mode !== 'current') {
  baseline = await runOnce('baseline', false);
  console.log(`[bench] scheduler-build baseline ${formatResult(baseline)}`);
}
if (mode !== 'baseline') {
  current = await runOnce('current', true);
  console.log(`[bench] scheduler-build current ${formatResult(current, baseline)}`);
}

if (mode === 'compare') {
  const delta = current.totalMs - baseline.totalMs;
  const pct = baseline.totalMs > 0 ? (delta / baseline.totalMs) * 100 : 0;
  console.log(`[bench] delta ms=${delta.toFixed(1)} (${pct.toFixed(1)}%)`);
}
