#!/usr/bin/env node
// Usage: node tools/bench/vfs/hash-routing-lookup.js --docs 20000 --lookups 50000 --json
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { formatStats, summarizeDurations, writeJsonWithDir } from '../micro/utils.js';
import { buildVfsVirtualPath, resolveVfsVirtualPath } from '../../../src/index/tooling/vfs.js';

const rawArgs = process.argv.slice(2);
const cli = createCli({
  scriptName: 'hash-routing-lookup',
  argv: ['node', 'hash-routing-lookup', ...rawArgs],
  options: {
    docs: { type: 'number', default: 20000, describe: 'Total virtual docs' },
    lookups: { type: 'number', default: 50000, describe: 'Lookup count' },
    samples: { type: 'number', default: 10, describe: 'Sample buckets for timing stats' },
    seed: { type: 'number', default: 1 },
    missingDocHashRate: { type: 'number', default: 0, describe: 'Fraction of docs missing docHash (forces legacy-path fallback)' },
    input: { type: 'string', describe: 'JSON file with virtualPaths array' },
    json: { type: 'boolean', default: false },
    out: { type: 'string', describe: 'Write JSON results to a file' }
  }
});
const argv = cli.parse();

const docs = clampInt(argv.docs, 1, 20000);
const lookups = clampInt(argv.lookups, 1, 50000);
const samples = clampInt(argv.samples, 1, 10);
const seed = Number.isFinite(argv.seed) ? Number(argv.seed) : 1;
const missingDocHashRate = clampFloat(argv.missingDocHashRate, 0, 1, 0);
const inputPath = argv.input ? path.resolve(String(argv.input)) : null;

const { virtualPaths, hashVirtualPaths, source, fallbacks, mismatches } = loadVirtualPaths({
  docs,
  seed,
  inputPath,
  missingDocHashRate
});
const lookupIndices = buildLookupIndices(lookups, virtualPaths.length, seed + 11);
const hashToPath = new Map(virtualPaths.map((virtualPath, idx) => [virtualPath, hashVirtualPaths[idx]]));

const encodeBench = runSampled({
  iterations: lookups,
  samples,
  fn: (i) => encodeURIComponent(virtualPaths[lookupIndices[i]])
});

const hashBench = runSampled({
  iterations: lookups,
  samples,
  fn: (i) => hashToPath.get(virtualPaths[lookupIndices[i]])
});

const results = {
  generatedAt: new Date().toISOString(),
  source,
  docs: virtualPaths.length,
  lookups,
  samples,
  missingDocHashRate,
  fallbacks,
  validation: { mismatches },
  bench: {
    pathEncode: encodeBench,
    hashLookup: hashBench
  }
};

if (argv.out) {
  const outPath = path.resolve(String(argv.out));
  writeJsonWithDir(outPath, results);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.error(`[hash-routing] docs=${results.docs} lookups=${lookups}`);
  printBench('path-encode', encodeBench);
  printBench('hash-lookup', hashBench);
}

function clampInt(value, min, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function clampFloat(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createRng(seedValue) {
  let state = (seedValue >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function buildLookupIndices(count, max, seedValue) {
  const rng = createRng(seedValue);
  const indices = new Array(count);
  for (let i = 0; i < count; i += 1) {
    indices[i] = Math.floor(rng() * max);
  }
  return indices;
}

function loadVirtualPaths({ docs: targetDocs, seed: seedValue, inputPath: input, missingDocHashRate: missingRate }) {
  let virtualPaths = null;
  let hashVirtualPaths = null;
  let source = { type: 'generated' };
  let fallbacks = { legacyPath: 0, missingDocHash: 0 };
  let mismatches = 0;

  if (input) {
    if (!fs.existsSync(input)) {
      throw new Error(`Input not found: ${input}`);
    }
    const payload = JSON.parse(fs.readFileSync(input, 'utf8'));
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.virtualPaths)
        ? payload.virtualPaths
        : Array.isArray(payload?.paths)
          ? payload.paths
          : [];
    virtualPaths = list.filter((entry) => typeof entry === 'string');
    if (!virtualPaths.length) {
      throw new Error('Input file did not include virtualPaths.');
    }
    source = { type: 'input', inputPath: input };
    hashVirtualPaths = new Array(virtualPaths.length);
    for (let i = 0; i < virtualPaths.length; i += 1) {
      const effectiveExt = path.extname(virtualPaths[i]) || '';
      const docHash = formatDocHash(i);
      hashVirtualPaths[i] = `.poc-vfs/by-hash/${docHash}${effectiveExt}`;
    }
  }

  if (!virtualPaths) {
    const rng = createRng(seedValue);
    const exts = ['ts', 'js', 'py', 'go', 'rs'];
    virtualPaths = new Array(targetDocs);
    hashVirtualPaths = new Array(targetDocs);
    for (let i = 0; i < targetDocs; i += 1) {
      const ext = exts[i % exts.length];
      const dir = Math.floor(rng() * 500);
      const containerPath = `src/dir-${dir}/file-${i}.${ext}`;
      const segmentUid = `segu:v1:${i.toString(16)}`;
      const effectiveExt = `.${ext}`;
      const legacyVirtualPath = buildVfsVirtualPath({ containerPath, segmentUid, effectiveExt });
      const docHash = rng() < missingRate ? null : formatDocHash(i);
      const resolved = resolveVfsVirtualPath({
        containerPath,
        segmentUid,
        effectiveExt,
        docHash,
        hashRouting: true
      });
      if (!docHash) {
        fallbacks.legacyPath += 1;
        fallbacks.missingDocHash += 1;
      } else {
        const expected = `.poc-vfs/by-hash/${docHash}${effectiveExt}`;
        if (resolved !== expected) mismatches += 1;
      }
      virtualPaths[i] = legacyVirtualPath;
      hashVirtualPaths[i] = resolved;
    }
  }

  if (Number.isFinite(targetDocs) && virtualPaths.length > targetDocs) {
    virtualPaths = virtualPaths.slice(0, targetDocs);
    hashVirtualPaths = hashVirtualPaths.slice(0, targetDocs);
  }

  return { virtualPaths, hashVirtualPaths, source, fallbacks, mismatches };
}

function runSampled({ iterations, samples, fn }) {
  const timings = [];
  const perSample = Math.max(1, Math.floor(iterations / samples));
  const remainder = iterations - perSample * samples;
  let totalMs = 0;
  let index = 0;
  for (let i = 0; i < samples; i += 1) {
    const loops = perSample + (i < remainder ? 1 : 0);
    const start = process.hrtime.bigint();
    for (let j = 0; j < loops; j += 1) {
      fn(index);
      index += 1;
    }
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    timings.push(elapsed);
    totalMs += elapsed;
  }
  const stats = summarizeDurations(timings);
  const opsPerSec = totalMs > 0 ? iterations / (totalMs / 1000) : 0;
  return { totalMs, opsPerSec, stats };
}

function printBench(label, bench) {
  const stats = bench.stats ? formatStats(bench.stats) : 'n/a';
  const ops = Number.isFinite(bench.opsPerSec) ? bench.opsPerSec.toFixed(1) : 'n/a';
  console.error(`- ${label}: ${stats} | ops/sec ${ops}`);
}

function formatDocHash(index) {
  const value = BigInt(index);
  const hex = value.toString(16).padStart(16, '0');
  return `xxh64:${hex}`;
}
