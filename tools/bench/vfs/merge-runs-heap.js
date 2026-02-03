#!/usr/bin/env node
// Usage: node tools/bench/vfs/merge-runs-heap.js --runs 10,50,200 --run-size 2000 --json
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { formatStats, summarizeDurations, writeJsonWithDir } from '../micro/utils.js';

const rawArgs = process.argv.slice(2);
const cli = createCli({
  scriptName: 'merge-runs-heap',
  argv: ['node', 'merge-runs-heap', ...rawArgs],
  options: {
    runs: { type: 'string', default: '10,50,200', describe: 'Run counts (comma-separated)' },
    runSize: { type: 'number', default: 2000, describe: 'Entries per run' },
    samples: { type: 'number', default: 3, describe: 'Repeat count for timing stats' },
    seed: { type: 'number', default: 1 },
    json: { type: 'boolean', default: false },
    out: { type: 'string', describe: 'Write JSON results to a file' }
  }
});
const argv = cli.parse();

const runSizes = parseRunCounts(argv.runs);
const runSize = clampInt(argv.runSize, 1, 2000);
const samples = clampInt(argv.samples, 1, 3);
const seed = Number.isFinite(argv.seed) ? Number(argv.seed) : 1;

const scenarios = [];
for (const runCount of runSizes) {
  const runs = buildRuns({ runCount, runSize, seed: seed + runCount });
  const linear = runMergeBench({ runs, samples, fn: mergeLinear });
  const heap = runMergeBench({ runs, samples, fn: mergeHeap });
  scenarios.push({
    runs: runCount,
    runSize,
    items: runCount * runSize,
    linear,
    heap
  });
}

const results = {
  generatedAt: new Date().toISOString(),
  scenarios
};

if (argv.out) {
  const outPath = path.resolve(String(argv.out));
  writeJsonWithDir(outPath, results);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const scenario of scenarios) {
    console.error(`[merge-runs] runs=${scenario.runs} runSize=${scenario.runSize}`);
    printBench('linear', scenario.linear, scenario.items);
    printBench('heap', scenario.heap, scenario.items);
  }
}

function clampInt(value, min, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function parseRunCounts(value) {
  if (Array.isArray(value)) return value.map((entry) => clampInt(entry, 1, 1));
  if (typeof value === 'number') return [clampInt(value, 1, 1)];
  if (!value) return [10, 50, 200];
  return String(value)
    .split(',')
    .map((entry) => clampInt(entry.trim(), 1, 1))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
}

function createRng(seedValue) {
  let state = (seedValue >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function buildRuns({ runCount, runSize, seed }) {
  const rng = createRng(seed);
  const runs = new Array(runCount);
  for (let i = 0; i < runCount; i += 1) {
    const run = new Array(runSize);
    let value = i;
    for (let j = 0; j < runSize; j += 1) {
      value += runCount + Math.floor(rng() * 2);
      run[j] = value;
    }
    runs[i] = run;
  }
  return runs;
}

function mergeLinear(runs) {
  const pointers = new Array(runs.length).fill(0);
  let checksum = 0;
  let last = -Infinity;
  const totalItems = runs.reduce((sum, run) => sum + run.length, 0);
  for (let out = 0; out < totalItems; out += 1) {
    let minIndex = -1;
    let minValue = 0;
    for (let i = 0; i < runs.length; i += 1) {
      const idx = pointers[i];
      if (idx >= runs[i].length) continue;
      const value = runs[i][idx];
      if (minIndex === -1 || value < minValue) {
        minIndex = i;
        minValue = value;
      }
    }
    pointers[minIndex] += 1;
    last = minValue;
    checksum = (checksum + minValue) % 1000000007;
  }
  return { count: totalItems, checksum, last };
}

function mergeHeap(runs) {
  const heap = new MinHeap();
  const positions = new Array(runs.length).fill(0);
  for (let i = 0; i < runs.length; i += 1) {
    if (runs[i].length) {
      heap.push({ value: runs[i][0], runIndex: i });
    }
  }
  let checksum = 0;
  let last = -Infinity;
  let count = 0;
  while (heap.size() > 0) {
    const next = heap.pop();
    count += 1;
    last = next.value;
    checksum = (checksum + next.value) % 1000000007;
    const runIndex = next.runIndex;
    positions[runIndex] += 1;
    const nextPos = positions[runIndex];
    if (nextPos < runs[runIndex].length) {
      heap.push({ value: runs[runIndex][nextPos], runIndex });
    }
  }
  return { count, checksum, last };
}

class MinHeap {
  constructor() {
    this.data = [];
  }

  size() {
    return this.data.length;
  }

  push(entry) {
    this.data.push(entry);
    this.bubbleUp(this.data.length - 1);
  }

  pop() {
    if (!this.data.length) return null;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length && last) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  bubbleUp(index) {
    const entry = this.data[index];
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.data[parentIndex];
      if (entry.value >= parent.value) break;
      this.data[parentIndex] = entry;
      this.data[index] = parent;
      index = parentIndex;
    }
  }

  sinkDown(index) {
    const length = this.data.length;
    const entry = this.data[index];
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let swapIndex = -1;
      if (leftIndex < length) {
        if (this.data[leftIndex].value < entry.value) {
          swapIndex = leftIndex;
        }
      }
      if (rightIndex < length) {
        const rightValue = this.data[rightIndex].value;
        if (swapIndex === -1) {
          if (rightValue < entry.value) swapIndex = rightIndex;
        } else if (rightValue < this.data[swapIndex].value) {
          swapIndex = rightIndex;
        }
      }
      if (swapIndex === -1) break;
      this.data[index] = this.data[swapIndex];
      this.data[swapIndex] = entry;
      index = swapIndex;
    }
  }
}

function runMergeBench({ runs, samples, fn }) {
  const timings = [];
  let totalMs = 0;
  let checksum = 0;
  const items = runs.reduce((sum, run) => sum + run.length, 0);
  for (let i = 0; i < samples; i += 1) {
    const start = process.hrtime.bigint();
    const result = fn(runs);
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    timings.push(elapsed);
    totalMs += elapsed;
    checksum = (checksum + (result?.checksum || 0)) % 1000000007;
  }
  const stats = summarizeDurations(timings);
  const itemsPerSec = totalMs > 0 ? items / (totalMs / 1000) : 0;
  return { totalMs, itemsPerSec, stats, checksum };
}

function printBench(label, bench, items) {
  const stats = bench.stats ? formatStats(bench.stats) : 'n/a';
  const rate = Number.isFinite(bench.itemsPerSec) ? bench.itemsPerSec.toFixed(1) : 'n/a';
  console.error(`- ${label}: ${stats} | items=${items} | items/sec ${rate}`);
}
