#!/usr/bin/env node
// Usage: node tools/bench/vfs/coalesce-docs.js --files 200 --segments 50 --merge-prob 0.6 --json
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { formatStats, summarizeDurations, writeJsonWithDir } from '../micro/utils.js';

const rawArgs = process.argv.slice(2);
const cli = createCli({
  scriptName: 'coalesce-docs',
  argv: ['node', 'coalesce-docs', ...rawArgs],
  options: {
    files: { type: 'number', default: 200, describe: 'Total files' },
    segments: { type: 'number', default: 50, describe: 'Segments per file' },
    languages: { type: 'number', default: 4, describe: 'Language variety' },
    mergeProb: { type: 'number', default: 0.6, describe: 'Probability adjacent segments share language/ext' },
    samples: { type: 'number', default: 5, describe: 'Repeat count for timing stats' },
    seed: { type: 'number', default: 1 },
    json: { type: 'boolean', default: false },
    out: { type: 'string', describe: 'Write JSON results to a file' }
  }
});
const argv = cli.parse();

const fileCount = clampInt(argv.files, 1, 200);
const segmentsPerFile = clampInt(argv.segments, 1, 50);
const languageCount = clampInt(argv.languages, 1, 4);
const mergeProb = Number.isFinite(argv.mergeProb) ? Math.min(1, Math.max(0, Number(argv.mergeProb))) : 0.6;
const samples = clampInt(argv.samples, 1, 5);
const seed = Number.isFinite(argv.seed) ? Number(argv.seed) : 1;

const segments = buildSegments({
  fileCount,
  segmentsPerFile,
  languageCount,
  mergeProb,
  seed
});

const baseline = runBaselineBench({ segments, samples });
const coalesce = runCoalesceBench({ segments, samples });

const results = {
  generatedAt: new Date().toISOString(),
  files: fileCount,
  segmentsPerFile,
  totalSegments: segments.length,
  languages: languageCount,
  mergeProb,
  samples,
  bench: {
    baseline,
    coalesce
  }
};

if (argv.out) {
  const outPath = path.resolve(String(argv.out));
  writeJsonWithDir(outPath, results);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.error(`[coalesce-docs] files=${fileCount} segments=${segments.length}`);
  printBench('baseline', baseline);
  printBench('coalesce', coalesce);
}

function clampInt(value, min, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function createRng(seedValue) {
  let state = (seedValue >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function buildSegments({ fileCount, segmentsPerFile, languageCount, mergeProb, seed }) {
  const rng = createRng(seed);
  const languages = ['typescript', 'javascript', 'python', 'go', 'rust'];
  const maxLanguages = Math.min(languageCount, languages.length);
  const segments = [];
  for (let file = 0; file < fileCount; file += 1) {
    let offset = 0;
    let lastLang = null;
    for (let seg = 0; seg < segmentsPerFile; seg += 1) {
      const shouldMerge = lastLang && rng() < mergeProb;
      const lang = shouldMerge ? lastLang : languages[Math.floor(rng() * maxLanguages)];
      const ext = lang === 'typescript' ? 'ts' : lang === 'javascript' ? 'js' : lang === 'python' ? 'py' : lang === 'go' ? 'go' : 'rs';
      const length = 80 + Math.floor(rng() * 120);
      const start = offset;
      const end = offset + length;
      segments.push({
        fileId: file,
        start,
        end,
        language: lang,
        ext
      });
      offset = end;
      lastLang = lang;
    }
  }
  return segments;
}

function coalesceSegments(segments) {
  const result = [];
  let current = null;
  for (const segment of segments) {
    if (
      current &&
      current.fileId === segment.fileId &&
      current.language === segment.language &&
      current.ext === segment.ext &&
      current.end === segment.start
    ) {
      current.end = segment.end;
      continue;
    }
    if (current) result.push(current);
    current = { ...segment };
  }
  if (current) result.push(current);
  return result;
}

function baselineSegments(segments) {
  let count = 0;
  for (const segment of segments) {
    if (!segment) continue;
    count += 1;
  }
  return count;
}

function runBaselineBench({ segments, samples }) {
  const timings = [];
  let totalMs = 0;
  let lastCount = 0;
  for (let i = 0; i < samples; i += 1) {
    const start = process.hrtime.bigint();
    lastCount = baselineSegments(segments);
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    timings.push(elapsed);
    totalMs += elapsed;
  }
  const stats = summarizeDurations(timings);
  const docsBefore = segments.length;
  const docsAfter = lastCount;
  const opsPerSec = totalMs > 0 ? docsBefore / (totalMs / 1000) : 0;
  return {
    totalMs,
    stats,
    docsBefore,
    docsAfter,
    lspOpsBefore: docsBefore,
    lspOpsAfter: docsAfter,
    opsPerSec
  };
}

function runCoalesceBench({ segments, samples }) {
  const timings = [];
  let totalMs = 0;
  let lastResult = null;
  for (let i = 0; i < samples; i += 1) {
    const start = process.hrtime.bigint();
    const result = coalesceSegments(segments);
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    timings.push(elapsed);
    totalMs += elapsed;
    lastResult = result;
  }
  const stats = summarizeDurations(timings);
  const docsBefore = segments.length;
  const docsAfter = lastResult ? lastResult.length : 0;
  const opsPerSec = totalMs > 0 ? docsBefore / (totalMs / 1000) : 0;
  return {
    totalMs,
    stats,
    docsBefore,
    docsAfter,
    lspOpsBefore: docsBefore,
    lspOpsAfter: docsAfter,
    opsPerSec
  };
}

function printBench(label, bench) {
  const stats = bench.stats ? formatStats(bench.stats) : 'n/a';
  const ops = Number.isFinite(bench.opsPerSec) ? bench.opsPerSec.toFixed(1) : 'n/a';
  console.error(`- ${label}: ${stats} | docs ${bench.docsBefore} -> ${bench.docsAfter} | ops/sec ${ops}`);
}
