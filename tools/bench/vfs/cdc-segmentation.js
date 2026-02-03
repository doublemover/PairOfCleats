#!/usr/bin/env node
// Usage: node tools/bench/vfs/cdc-segmentation.js --size 100000 --edits 200 --json
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { writeJsonWithDir } from '../micro/utils.js';

const rawArgs = process.argv.slice(2);
const cli = createCli({
  scriptName: 'cdc-segmentation',
  argv: ['node', 'cdc-segmentation', ...rawArgs],
  options: {
    size: { type: 'number', default: 100000, describe: 'Base content size' },
    edits: { type: 'number', default: 200, describe: 'Edit operations' },
    chunk: { type: 'number', default: 1024, describe: 'Fixed chunk size' },
    min: { type: 'number', default: 512, describe: 'CDC min chunk size' },
    avg: { type: 'number', default: 1024, describe: 'CDC avg chunk size' },
    max: { type: 'number', default: 2048, describe: 'CDC max chunk size' },
    seed: { type: 'number', default: 1 },
    json: { type: 'boolean', default: false },
    out: { type: 'string', describe: 'Write JSON results to a file' }
  }
});
const argv = cli.parse();

const size = clampInt(argv.size, 1000, 100000);
const edits = clampInt(argv.edits, 1, 200);
const fixedChunk = clampInt(argv.chunk, 64, 1024);
const minSize = clampInt(argv.min, 64, 512);
const avgSize = clampInt(argv.avg, minSize, 1024);
const maxSize = clampInt(argv.max, avgSize, 2048);
const seed = Number.isFinite(argv.seed) ? Number(argv.seed) : 1;

const rng = createRng(seed);
const baseText = randomText(size, rng);
const editedText = applyEdits(baseText, edits, rng);

const fixedBase = timeSegment(() => segmentFixed(baseText, fixedChunk));
const fixedEdited = timeSegment(() => segmentFixed(editedText, fixedChunk));
const fixedChurn = computeChurn(fixedBase.segments, fixedEdited.segments);

const cdcParams = {
  minSize,
  avgSize,
  maxSize,
  mask: avgSize - 1
};
const cdcBase = timeSegment(() => segmentCdc(baseText, cdcParams));
const cdcEdited = timeSegment(() => segmentCdc(editedText, cdcParams));
const cdcChurn = computeChurn(cdcBase.segments, cdcEdited.segments);

const results = {
  generatedAt: new Date().toISOString(),
  size,
  edits,
  fixedChunk,
  cdc: cdcParams,
  fixed: {
    baseSegments: fixedBase.segments.length,
    editedSegments: fixedEdited.segments.length,
    baseMs: fixedBase.ms,
    editedMs: fixedEdited.ms,
    churn: fixedChurn
  },
  cdcSegments: {
    baseSegments: cdcBase.segments.length,
    editedSegments: cdcEdited.segments.length,
    baseMs: cdcBase.ms,
    editedMs: cdcEdited.ms,
    churn: cdcChurn
  }
};

if (argv.out) {
  const outPath = path.resolve(String(argv.out));
  writeJsonWithDir(outPath, results);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.error(`[cdc-segmentation] size=${size} edits=${edits}`);
  console.error(`- fixed churn ${(fixedChurn * 100).toFixed(2)}%`);
  console.error(`- cdc churn ${(cdcChurn * 100).toFixed(2)}%`);
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

function randomText(length, rng) {
  const chars = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const code = 97 + Math.floor(rng() * 26);
    chars[i] = String.fromCharCode(code);
  }
  return chars.join('');
}

function applyEdits(text, edits, rng) {
  let value = text;
  for (let i = 0; i < edits; i += 1) {
    const index = Math.floor(rng() * value.length);
    const insert = rng() < 0.5;
    const changeSize = 1 + Math.floor(rng() * 4);
    if (insert) {
      const addition = randomText(changeSize, rng);
      value = value.slice(0, index) + addition + value.slice(index);
    } else {
      const end = Math.min(value.length, index + changeSize);
      value = value.slice(0, index) + value.slice(end);
    }
  }
  return value;
}

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function segmentFixed(text, size) {
  const segments = [];
  for (let i = 0; i < text.length; i += size) {
    const slice = text.slice(i, i + size);
    segments.push(hashString(slice));
  }
  return segments;
}

function segmentCdc(text, { minSize, avgSize, maxSize, mask }) {
  const segments = [];
  let start = 0;
  let rolling = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    rolling = ((rolling << 1) + code) & 0xffffffff;
    const length = i - start + 1;
    const cut = length >= minSize && ((rolling & mask) === 0 || length >= maxSize);
    if (cut) {
      segments.push(hashString(text.slice(start, i + 1)));
      start = i + 1;
      rolling = 0;
    }
  }
  if (start < text.length) {
    segments.push(hashString(text.slice(start)));
  }
  return segments;
}

function computeChurn(baseSegments, editedSegments) {
  const counts = new Map();
  for (const value of baseSegments) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  let common = 0;
  for (const value of editedSegments) {
    const current = counts.get(value) || 0;
    if (current > 0) {
      counts.set(value, current - 1);
      common += 1;
    }
  }
  const denom = Math.max(baseSegments.length, editedSegments.length) || 1;
  return 1 - common / denom;
}

function timeSegment(fn) {
  const start = process.hrtime.bigint();
  const segments = fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { segments, ms };
}
