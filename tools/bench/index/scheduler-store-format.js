#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { loadChunkMeta, MAX_JSON_BYTES, readJsonFile } from '../../../src/shared/artifact-io.js';
import { resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';
import { mergeConfig } from '../../../src/shared/config.js';
import { getRepoId } from '../../shared/dict-utils.js';

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

const average = (values) => (
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
);

const resolveBuildRootFromCurrent = async (repoCacheRoot) => {
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const currentPath = path.join(buildsRoot, 'current.json');
  const current = readJsonFile(currentPath, { maxBytes: MAX_JSON_BYTES }) || {};
  if (typeof current?.buildRoot === 'string' && current.buildRoot.trim()) {
    const value = current.buildRoot.trim();
    return path.isAbsolute(value) ? value : path.join(repoCacheRoot, value);
  }
  if (typeof current?.buildId === 'string' && current.buildId.trim()) {
    return path.join(buildsRoot, current.buildId.trim());
  }
  throw new Error(`current.json missing buildRoot/buildId: ${currentPath}`);
};

const parseMode = (value) => {
  const lowered = String(value || '').trim().toLowerCase();
  if (lowered === 'baseline' || lowered === 'current' || lowered === 'compare') return lowered;
  return 'compare';
};

const args = parseArgs();
const mode = parseMode(args.mode);
const runs = Math.max(1, Number(args.runs) || 3);
const repoRoot = args.repo
  ? path.resolve(String(args.repo))
  : path.join(process.cwd(), 'tests', 'fixtures', 'medium');
const benchRoot = args.root
  ? path.resolve(String(args.root))
  : path.join(process.cwd(), '.benchCache', 'scheduler-store-format');
const jsonOutput = args.json === true;

const schedulerVariants = {
  baseline: {
    label: 'baseline(rows/jsonl)',
    patch: {
      indexing: {
        treeSitter: {
          scheduler: {
            store: 'rows',
            format: 'jsonl'
          }
        }
      }
    }
  },
  current: {
    label: 'current(paged-json/binary-v1)',
    patch: {
      indexing: {
        treeSitter: {
          scheduler: {
            store: 'paged-json',
            format: 'binary-v1'
          }
        }
      }
    }
  }
};

// These are valid runtime flags but not in public config schema yet.
const commonTestOverride = {
  indexing: {
    artifacts: {
      chunkMetaBinaryColumnar: false,
      tokenPostingsBinaryColumnar: false
    }
  }
};

const buildTestOverride = (key) => mergeConfig(commonTestOverride, schedulerVariants[key].patch);

const getCodeChunkCount = async (cacheRoot) => {
  const versionedRoot = resolveVersionedCacheRoot(cacheRoot);
  const repoCacheRoot = path.join(versionedRoot, 'repos', getRepoId(repoRoot));
  const buildRoot = await resolveBuildRootFromCurrent(repoCacheRoot);
  const codeDir = path.join(buildRoot, 'index-code');
  const chunkMeta = await loadChunkMeta(codeDir, { maxBytes: MAX_JSON_BYTES });
  return Array.isArray(chunkMeta) ? chunkMeta.length : 0;
};

const runVariantOnce = async (key, runNumber, cacheRoot) => {
  await fs.rm(cacheRoot, { recursive: true, force: true });
  await fs.mkdir(cacheRoot, { recursive: true });

  const env = {
    ...process.env,
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_SCHEDULER: '1',
    PAIROFCLEATS_TESTING: '1',
    PAIROFCLEATS_TEST_CONFIG: JSON.stringify(buildTestOverride(key))
  };
  const buildArgs = [
    path.join(process.cwd(), 'build_index.js'),
    '--stub-embeddings',
    '--scm-provider',
    'none',
    '--progress',
    'off',
    '--repo',
    repoRoot,
    '--quiet'
  ];

  const startedAt = performance.now();
  const result = spawnSync(process.execPath, buildArgs, {
    env,
    cwd: repoRoot,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`build_index failed for ${key} run ${runNumber} (exit=${result.status})`);
  }
  const totalMs = performance.now() - startedAt;
  const chunkCount = await getCodeChunkCount(cacheRoot);
  if (!Number.isFinite(chunkCount) || chunkCount <= 0) {
    throw new Error(`No code chunks found for ${key} run ${runNumber}; benchmark invalid.`);
  }
  const throughput = totalMs > 0 ? (chunkCount / (totalMs / 1000)) : 0;
  return { runNumber, totalMs, chunkCount, throughput };
};

const summarize = (rows) => {
  const durations = rows.map((entry) => entry.totalMs);
  const throughputs = rows.map((entry) => entry.throughput);
  const chunks = rows.map((entry) => entry.chunkCount);
  return {
    runs: rows.length,
    avgMs: average(durations),
    p50Ms: percentile(durations, 0.5),
    p90Ms: percentile(durations, 0.9),
    bestMs: durations.length ? Math.min(...durations) : 0,
    worstMs: durations.length ? Math.max(...durations) : 0,
    avgThroughput: average(throughputs),
    avgChunks: average(chunks)
  };
};

const printRun = (key, run) => {
  console.log(
    `[bench] scheduler-store-format ${key} run=${run.runNumber} `
    + `chunks=${run.chunkCount} total=${run.totalMs.toFixed(1)}ms `
    + `throughput=${run.throughput.toFixed(2)} chunks/s`
  );
};

const printSummary = (key, summary) => {
  console.log(
    `[bench] scheduler-store-format ${key} summary `
    + `runs=${summary.runs} avg=${summary.avgMs.toFixed(1)}ms `
    + `p50=${summary.p50Ms.toFixed(1)}ms p90=${summary.p90Ms.toFixed(1)}ms `
    + `best=${summary.bestMs.toFixed(1)}ms worst=${summary.worstMs.toFixed(1)}ms `
    + `avgThroughput=${summary.avgThroughput.toFixed(2)} chunks/s`
  );
};

const printDelta = (baseline, current) => {
  const deltaMs = current.avgMs - baseline.avgMs;
  const deltaPct = baseline.avgMs > 0 ? (deltaMs / baseline.avgMs) * 100 : 0;
  const throughputDelta = current.avgThroughput - baseline.avgThroughput;
  const throughputPct = baseline.avgThroughput > 0
    ? (throughputDelta / baseline.avgThroughput) * 100
    : 0;
  console.log(
    `[bench] scheduler-store-format delta `
    + `avgMs=${deltaMs.toFixed(1)} (${deltaPct.toFixed(1)}%) `
    + `avgThroughput=${throughputDelta.toFixed(2)} chunks/s `
    + `(${throughputPct.toFixed(1)}%)`
  );
};

const runVariant = async (key, cacheRoot) => {
  const rows = [];
  for (let i = 0; i < runs; i += 1) {
    const run = await runVariantOnce(key, i + 1, cacheRoot);
    rows.push(run);
    printRun(key, run);
  }
  const summary = summarize(rows);
  printSummary(key, summary);
  return { key, label: schedulerVariants[key].label, rows, summary };
};

await fs.mkdir(benchRoot, { recursive: true });

let baseline = null;
let current = null;

if (mode !== 'current') {
  const baselineCacheRoot = path.join(benchRoot, 'cache', 'baseline');
  baseline = await runVariant('baseline', baselineCacheRoot);
}

if (mode !== 'baseline') {
  const currentCacheRoot = path.join(benchRoot, 'cache', 'current');
  current = await runVariant('current', currentCacheRoot);
}

if (mode === 'compare' && baseline && current) {
  printDelta(baseline.summary, current.summary);
}

if (jsonOutput) {
  const payload = {
    mode,
    runs,
    repoRoot,
    benchRoot,
    baseline,
    current
  };
  console.log(JSON.stringify(payload, null, 2));
}
