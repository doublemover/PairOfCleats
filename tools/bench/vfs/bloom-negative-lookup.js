#!/usr/bin/env node
// Usage: node tools/bench/vfs/bloom-negative-lookup.js --keys 50000 --lookups 100000 --json
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { BloomFilter } from '../../../src/shared/bloom.js';
import { writeJsonWithDir } from '../micro/utils.js';
import { clampInt, createRng, printBench, runSampled } from './shared.js';

function main() {
  const rawArgs = process.argv.slice(2);
  const cli = createCli({
    scriptName: 'bloom-negative-lookup',
    argv: ['node', 'bloom-negative-lookup', ...rawArgs],
    options: {
      keys: { type: 'number', default: 50000, describe: 'Positive keys in the filter' },
      lookups: { type: 'number', default: 100000, describe: 'Negative lookup count' },
      bits: { type: 'number', default: 1000000, describe: 'Bloom filter size in bits' },
      hashes: { type: 'number', default: 3, describe: 'Hash functions' },
      samples: { type: 'number', default: 10, describe: 'Sample buckets for timing stats' },
      seed: { type: 'number', default: 1 },
      json: { type: 'boolean', default: false },
      out: { type: 'string', describe: 'Write JSON results to a file' }
    }
  });
  const argv = cli.parse();

  const keyCount = clampInt(argv.keys, 1, 50000);
  const lookupCount = clampInt(argv.lookups, 1, 100000);
  const bits = clampInt(argv.bits, 1024, 1000000);
  const hashCount = clampInt(argv.hashes, 1, 3);
  const samples = clampInt(argv.samples, 1, 10);
  const seed = Number.isFinite(argv.seed) ? Number(argv.seed) : 1;

  const rng = createRng(seed);
  const keys = new Array(keyCount);
  const keySet = new Set();
  for (let i = 0; i < keyCount; i += 1) {
    const value = `doc-${i}-${Math.floor(rng() * 1e9)}`;
    keys[i] = value;
    keySet.add(value);
  }

  const negatives = new Array(lookupCount);
  for (let i = 0; i < lookupCount; i += 1) {
    negatives[i] = `miss-${i}-${Math.floor(rng() * 1e9)}`;
  }

  const bloom = new BloomFilter({ bits, hashes: hashCount });
  for (const key of keys) bloom.add(key);

  const bloomBench = runSampled({
    iterations: lookupCount,
    samples,
    fn: (i) => bloom.has(negatives[i])
  });

  const setBench = runSampled({
    iterations: lookupCount,
    samples,
    fn: (i) => keySet.has(negatives[i])
  });

  let falsePositives = 0;
  for (const key of negatives) {
    if (bloom.has(key)) falsePositives += 1;
  }

  const results = {
    generatedAt: new Date().toISOString(),
    keys: keyCount,
    lookups: lookupCount,
    bits,
    hashes: hashCount,
    falsePositives,
    falsePositiveRate: falsePositives / lookupCount,
    bench: {
      bloom: bloomBench,
      set: setBench
    }
  };

  if (argv.out) {
    const outPath = path.resolve(String(argv.out));
    writeJsonWithDir(outPath, results);
  }

  if (argv.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.error(`[bloom-negative] keys=${keyCount} lookups=${lookupCount}`);
    console.error(`- false positive rate ${(results.falsePositiveRate * 100).toFixed(2)}%`);
    printBench('bloom', bloomBench);
    printBench('set', setBench);
  }
}

main();
