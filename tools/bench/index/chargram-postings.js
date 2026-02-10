#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildPostings } from '../../../src/index/build/postings.js';
import { normalizePostingsConfig } from '../../../src/shared/postings-config.js';

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
const vocabSize = Number(args.vocab) || 250000;
const docs = Number(args.docs) || 50000;
const postingsPerToken = Number(args.postings) || 3;
const spillThreshold = Number(args.spill) || 100000;
const enableRollingHash = args.rolling === true || args['rolling-hash'] === true;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const benchRoot = path.join(process.cwd(), '.benchCache', 'chargram-postings');
await fs.mkdir(benchRoot, { recursive: true });

const MASK_64 = (1n << 64n) - 1n;
const MIX_CONST = 0x9e3779b97f4a7c15n;

const formatH64 = (value) => {
  const normalized = (value & MASK_64).toString(16);
  return normalized.length >= 16 ? normalized.slice(-16) : normalized.padStart(16, '0');
};

const buildChargramKey = (i) => {
  if (enableRollingHash) {
    const mixed = (BigInt(i) * MIX_CONST) & MASK_64;
    return `h64:${formatH64(mixed)}`;
  }
  return i.toString(36).padStart(4, '0');
};

const buildTriPost = () => {
  const map = new Map();
  for (let i = 0; i < vocabSize; i += 1) {
    const token = buildChargramKey(i);
    const postings = new Array(postingsPerToken);
    const base = (i * 131) % Math.max(docs, 1);
    for (let j = 0; j < postingsPerToken; j += 1) {
      postings[j] = base + j;
    }
    map.set(token, postings);
  }
  return map;
};

const buildChunkMeta = () => (
  Array.from({ length: docs }, () => ({ tokenCount: 0 }))
);

const runOnce = async (label, spillMaxUnique) => {
  const buildRoot = path.join(benchRoot, label);
  await fs.rm(buildRoot, { recursive: true, force: true });
  await fs.mkdir(buildRoot, { recursive: true });
  const triPost = buildTriPost();
  const postingsConfig = normalizePostingsConfig({
    enableChargrams: true,
    enablePhraseNgrams: false,
    chargramSpillMaxUnique: spillMaxUnique
  });
  const chunks = buildChunkMeta();
  const docLengths = new Array(docs).fill(0);
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  const result = await buildPostings({
    chunks,
    df: new Map(),
    tokenPostings: new Map(),
    docLengths,
    fieldPostings: {},
    fieldDocLengths: {},
    phrasePost: new Map(),
    triPost,
    postingsConfig,
    postingsGuard: null,
    buildRoot,
    modelId: 'bench',
    useStubEmbeddings: true,
    log: () => {},
    workerPool: null,
    quantizePool: null,
    embeddingsEnabled: false
  });
  const durationMs = performance.now() - start;
  const heapAfter = process.memoryUsage().heapUsed;
  return {
    label,
    algorithm: enableRollingHash ? 'rolling-hash' : 'substring',
    durationMs,
    heapDelta: heapAfter - heapBefore,
    vocab: result.chargramVocab.length,
    stats: result.chargramStats || null
  };
};

const formatStats = (label, stats) => {
  if (!stats) return `${label} stats=none`;
  const parts = [
    `spill=${stats.spillEnabled ? 'on' : 'off'}`,
    `runs=${stats.spillRuns || 0}`,
    `rows=${stats.spillRows || 0}`,
    `bytes=${stats.spillBytes || 0}`
  ];
  return `${label} ${parts.join(' ')}`;
};

const printResult = (result, baseline = null) => {
  const parts = [
    `algo=${result.algorithm}`,
    `ms=${result.durationMs.toFixed(1)}`,
    `heapΔ=${(result.heapDelta / (1024 * 1024)).toFixed(1)}MB`,
    `vocab=${result.vocab}`
  ];
  if (baseline) {
    const delta = result.durationMs - baseline.durationMs;
    const pct = baseline.durationMs > 0 ? (delta / baseline.durationMs) * 100 : null;
    parts.push(`delta=${delta.toFixed(1)}ms (${pct?.toFixed(1)}%)`);
  }
  console.log(`[bench] ${result.label} ${parts.join(' ')} | ${formatStats('chargram', result.stats)}`);
};

let baseline = null;
let current = null;

if (mode !== 'current') {
  baseline = await runOnce('baseline', 0);
  printResult(baseline);
}

if (mode !== 'baseline') {
  current = await runOnce('current', spillThreshold);
  printResult(current, baseline);
}

if (baseline && current) {
  const deltaMs = current.durationMs - baseline.durationMs;
  const pct = baseline.durationMs > 0 ? (deltaMs / baseline.durationMs) * 100 : 0;
  console.log(`[bench] delta ms=${deltaMs.toFixed(1)} (${pct.toFixed(1)}%)`);
}

const summary = {
  generatedAt: new Date().toISOString(),
  algo: enableRollingHash ? 'rolling-hash' : 'substring',
  vocabSize,
  docs,
  postingsPerToken,
  spillThreshold,
  baseline,
  current
};
console.log(JSON.stringify(summary, null, 2));
