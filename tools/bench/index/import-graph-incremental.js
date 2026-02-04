#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { sha1 } from '../../../src/shared/hash.js';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';

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

const createRng = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

const args = parseArgs();
const fileCount = Number(args.files) || 2000;
const importsPerFile = Number(args.imports) || 6;
const dirtyRate = Math.min(1, Math.max(0, Number(args.dirtyRate) || 0.1));
const seed = Number(args.seed) || 1337;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const rng = createRng(seed);
const benchRoot = path.join(process.cwd(), '.benchCache', 'import-graph-incremental');
await fs.mkdir(benchRoot, { recursive: true });

const root = path.join(benchRoot, 'repo');
const files = Array.from({ length: fileCount }, (_, index) => `src/module-${index}.ts`);
const entries = files.map((rel) => ({ rel, abs: path.join(root, rel) }));
const importsByFile = new Map();
const baseRelations = new Map();

for (const rel of files) {
  const list = [];
  for (let i = 0; i < importsPerFile; i += 1) {
    const target = pick(rng, files);
    const relDir = path.posix.dirname(rel);
    let spec = path.posix.relative(relDir, target);
    if (!spec.startsWith('.')) spec = `./${spec}`;
    list.push(spec);
  }
  importsByFile.set(rel, list);
  baseRelations.set(rel, { imports: list.slice() });
}

const buildHashes = (salt = '') => {
  const hashes = new Map();
  for (const rel of files) {
    hashes.set(rel, sha1(`${salt}:${rel}`));
  }
  return hashes;
};

const applyDirty = (hashes) => {
  const next = new Map(hashes);
  for (const rel of files) {
    if (rng() < dirtyRate) {
      next.set(rel, sha1(`dirty:${rel}:${Date.now()}:${Math.random()}`));
    }
  }
  return next;
};

const runOnce = ({ label, cache, fileHashes, enableCache }) => {
  const relations = new Map(baseRelations);
  const start = performance.now();
  const result = resolveImportLinks({
    root,
    entries,
    importsByFile,
    fileRelations: relations,
    enableGraph: false,
    cache: enableCache ? cache : null,
    fileHashes: enableCache ? fileHashes : null
  });
  const durationMs = performance.now() - start;
  return { label, durationMs, cacheStats: result.cacheStats };
};

const formatReuse = (stats) => {
  if (!stats) return 'reuse=n/a';
  const files = stats.files || 0;
  const reused = stats.filesReused || 0;
  const ratio = files ? (reused / files) * 100 : 0;
  return `reuse=${reused}/${files} (${ratio.toFixed(1)}%)`;
};

const printResult = (result, baseline = null) => {
  const parts = [
    `ms=${result.durationMs.toFixed(1)}`,
    formatReuse(result.cacheStats)
  ];
  if (baseline) {
    const delta = result.durationMs - baseline.durationMs;
    const pct = baseline.durationMs > 0 ? (delta / baseline.durationMs) * 100 : null;
    parts.push(`delta=${delta.toFixed(1)}ms (${pct?.toFixed(1)}%)`);
  }
  console.log(`[bench] ${result.label} ${parts.join(' ')}`);
};

let baseline = null;
if (mode !== 'current') {
  baseline = runOnce({ label: 'baseline', enableCache: false, fileHashes: null, cache: null });
  printResult(baseline);
}

if (mode !== 'baseline') {
  const cache = { version: 1, generatedAt: null, packageFingerprint: null, files: {} };
  const hashes = buildHashes();
  runOnce({ label: 'seed', enableCache: true, fileHashes: hashes, cache });
  const warm = runOnce({ label: 'warm', enableCache: true, fileHashes: hashes, cache });
  printResult(warm, baseline);
  if (dirtyRate > 0) {
    const dirtyHashes = applyDirty(hashes);
    const dirty = runOnce({ label: 'dirty', enableCache: true, fileHashes: dirtyHashes, cache });
    printResult(dirty, baseline);
  }
}
