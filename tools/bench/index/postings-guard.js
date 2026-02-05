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
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const benchRoot = path.join(process.cwd(), '.benchCache', 'postings-guard');
await fs.mkdir(benchRoot, { recursive: true });

const buildTriPost = () => {
  const map = new Map();
  for (let i = 0; i < vocabSize; i += 1) {
    const token = `cg-${i.toString(36)}`;
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
    durationMs,
    heapDelta: heapAfter - heapBefore,
    vocab: result.chargramVocab.length,
    stats: result.chargramStats || null
  };
};

const throughput = (durationMs) => (durationMs > 0 ? vocabSize / (durationMs / 1000) : 0);

const formatStats = (stats) => {
  if (!stats) return 'spill=unknown';
  return `spill=${stats.spillEnabled ? 'on' : 'off'} runs=${stats.spillRuns || 0} bytes=${stats.spillBytes || 0}`;
};

const printResult = (result) => {
  const tp = throughput(result.durationMs);
  console.log(
    `[bench] ${result.label} vocab=${result.vocab} ms=${result.durationMs.toFixed(1)} ` +
    `throughput=${tp.toFixed(1)}/s heapΔ=${(result.heapDelta / (1024 * 1024)).toFixed(1)}MB ` +
    `${formatStats(result.stats)}`
  );
  return tp;
};

const printDelta = (baseline, current, baseTp, curTp) => {
  const deltaMs = current.durationMs - baseline.durationMs;
  const deltaPct = baseline.durationMs > 0 ? (deltaMs / baseline.durationMs) * 100 : 0;
  const deltaTp = curTp - baseTp;
  console.log(
    `[bench] delta ms=${deltaMs.toFixed(1)} (${deltaPct.toFixed(1)}%) ` +
    `throughput=${curTp.toFixed(1)}/s Δ=${deltaTp.toFixed(1)}/s ` +
    `heapΔ=${((current.heapDelta - baseline.heapDelta) / (1024 * 1024)).toFixed(1)}MB`
  );
};

let baseline = null;
let current = null;
let baseTp = 0;
let curTp = 0;

if (mode !== 'current') {
  baseline = await runOnce('baseline', 0);
  baseTp = printResult(baseline);
}

if (mode !== 'baseline') {
  current = await runOnce('current', spillThreshold);
  curTp = printResult(current);
}

if (baseline && current) {
  printDelta(baseline, current, baseTp, curTp);
}
