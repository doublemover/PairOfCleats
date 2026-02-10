#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadChunkMeta, loadGraphRelations, loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { createOrderingHasher, stableOrderWithComparator } from '../../../src/shared/order.js';
import { compareChunkMetaRows, createGraphRelationsIterator } from '../../../src/index/build/artifacts/helpers.js';
import { createFileRelationsIterator } from '../../../src/index/build/artifacts/writers/file-relations.js';
import { createRepoMapIterator } from '../../../src/index/build/artifacts/writers/repo-map.js';

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

const resolveIndexDir = (root, args) => {
  if (args.index) {
    const candidate = path.resolve(args.index);
    if (fs.existsSync(candidate)) return candidate;
    return null;
  }
  const guess = path.join(root, '.index-root', 'index-code');
  if (fs.existsSync(guess)) return guess;
  return null;
};

const normalizeFileRelations = (value) => {
  if (!value) return null;
  if (value && typeof value.entries === 'function') return value;
  if (!Array.isArray(value)) return null;
  const map = new Map();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const file = entry.file || entry.path;
    if (!file) continue;
    map.set(file, entry.relations || entry);
  }
  return map;
};

const loadArtifacts = async (dir) => {
  try {
    const chunkMeta = await loadChunkMeta(dir, { strict: false });
    const fileRelationsRaw = await loadJsonArrayArtifact(dir, 'file_relations', { strict: false })
      .catch(() => null);
    const fileRelations = normalizeFileRelations(fileRelationsRaw);
    const repoMap = await loadJsonArrayArtifact(dir, 'repo_map', { strict: false }).catch(() => null);
    const graphRelations = await loadGraphRelations(dir, { strict: false }).catch(() => null);
    return { chunkMeta, fileRelations, repoMap, graphRelations, source: 'index' };
  } catch {
    return null;
  }
};

const buildSyntheticArtifacts = ({
  chunkCount,
  fileCount,
  importsPerFile,
  edgesPerNode,
  seed
}) => {
  const rng = createRng(seed);
  const chunkMeta = Array.from({ length: chunkCount }, (_, index) => {
    const fileIndex = index % fileCount;
    return {
      id: index,
      file: `src/file-${fileIndex}.ts`,
      chunkUid: `ck:${index}`,
      chunkId: `chunk-${index}`,
      start: (index % 120) * 3,
      name: `symbol_${index}`
    };
  });

  const fileRelations = new Map();
  for (let i = 0; i < fileCount; i += 1) {
    const file = `src/file-${i}.ts`;
    const imports = [];
    for (let j = 0; j < importsPerFile; j += 1) {
      const target = Math.floor(rng() * fileCount);
      if (target === i) continue;
      imports.push(`./file-${target}.ts`);
    }
    const exports = [`symbol_${i}`];
    fileRelations.set(file, { imports, exports });
  }

  const nodeCount = Math.max(1, Math.floor(chunkCount / 20));
  const makeGraphNodes = () => {
    const nodes = [];
    const incoming = Array.from({ length: nodeCount }, () => []);
    for (let i = 0; i < nodeCount; i += 1) {
      const out = [];
      for (let j = 0; j < edgesPerNode; j += 1) {
        const target = (i + j + 1) % nodeCount;
        const targetId = `node-${target}`;
        out.push(targetId);
        incoming[target].push(`node-${i}`);
      }
      nodes.push({
        id: `node-${i}`,
        out,
        in: incoming[i]
      });
    }
    return nodes;
  };

  const graphRelations = {
    version: 2,
    generatedAt: new Date().toISOString(),
    callGraph: { nodes: makeGraphNodes() },
    usageGraph: { nodes: makeGraphNodes() },
    importGraph: { nodes: makeGraphNodes() }
  };

  return {
    chunkMeta,
    fileRelations,
    repoMap: null,
    graphRelations,
    source: 'synthetic'
  };
};

const hashRows = (rows, hasher) => {
  for (const row of rows) {
    hasher.update(JSON.stringify(row));
  }
};

const runOnce = ({
  label,
  hash,
  chunkMeta,
  fileRelations,
  repoMap,
  graphRelations
}) => {
  const start = performance.now();
  const counts = {
    chunkMeta: 0,
    fileRelations: 0,
    repoMap: 0,
    graphRelations: 0
  };

  if (Array.isArray(chunkMeta)) {
    const ordered = stableOrderWithComparator(chunkMeta, compareChunkMetaRows);
    counts.chunkMeta = ordered.length;
    if (hash) {
      const hasher = createOrderingHasher();
      hashRows(ordered, hasher);
      hasher.digest();
    }
  }

  if (fileRelations && typeof fileRelations.entries === 'function') {
    const iterator = createFileRelationsIterator(fileRelations);
    if (hash) {
      const hasher = createOrderingHasher();
      for (const entry of iterator()) {
        counts.fileRelations += 1;
        hasher.update(JSON.stringify(entry));
      }
      hasher.digest();
    } else {
      for (const entry of iterator()) {
        if (!entry) continue;
        counts.fileRelations += 1;
      }
    }
  }

  if (Array.isArray(repoMap)) {
    if (hash) {
      const hasher = createOrderingHasher();
      for (const entry of repoMap) {
        if (!entry) continue;
        counts.repoMap += 1;
        hasher.update(JSON.stringify(entry));
      }
      hasher.digest();
    } else {
      counts.repoMap = repoMap.length;
    }
  } else if (Array.isArray(chunkMeta)) {
    const repoMapIterator = createRepoMapIterator({ chunks: chunkMeta, fileRelations });
    if (hash) {
      const hasher = createOrderingHasher();
      for (const entry of repoMapIterator()) {
        counts.repoMap += 1;
        hasher.update(JSON.stringify(entry));
      }
      hasher.digest();
    } else {
      for (const entry of repoMapIterator()) {
        if (!entry) continue;
        counts.repoMap += 1;
      }
    }
  }

  if (graphRelations && typeof graphRelations === 'object') {
    const iterator = createGraphRelationsIterator(graphRelations)();
    if (hash) {
      const hasher = createOrderingHasher();
      for (const entry of iterator) {
        counts.graphRelations += 1;
        hasher.update(JSON.stringify(entry));
      }
      hasher.digest();
    } else {
      for (const entry of iterator) {
        if (!entry) continue;
        counts.graphRelations += 1;
      }
    }
  }

  const durationMs = performance.now() - start;
  const totalRows = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const throughput = durationMs > 0 ? totalRows / (durationMs / 1000) : 0;

  return {
    label,
    durationMs,
    totalRows,
    throughput,
    counts
  };
};

const printResult = (result) => {
  console.log(
    `[bench] ${result.label} rows=${result.totalRows} ` +
    `ms=${result.durationMs.toFixed(1)} throughput=${result.throughput.toFixed(1)}/s ` +
    `chunk_meta=${result.counts.chunkMeta} file_relations=${result.counts.fileRelations} ` +
    `repo_map=${result.counts.repoMap} graph_relations=${result.counts.graphRelations}`
  );
};

const printDelta = (baseline, current) => {
  const deltaMs = current.durationMs - baseline.durationMs;
  const deltaThroughput = current.throughput - baseline.throughput;
  const pct = baseline.durationMs > 0 ? (deltaMs / baseline.durationMs) * 100 : 0;
  console.log(
    `[bench] delta amount=${deltaMs.toFixed(1)}ms throughput=${deltaThroughput.toFixed(1)}/s ` +
    `percent=${pct.toFixed(1)} duration=${current.durationMs.toFixed(1)}ms`
  );
};

const args = parseArgs();
const root = process.cwd();
const seed = Number(args.seed) || 1337;
const chunkCount = Number(args.chunks) || 100000;
const fileCount = Number(args.files) || 20000;
const importsPerFile = Number(args.imports) || 4;
const edgesPerNode = Number(args.edges) || 3;
const ledgerFlag = typeof args.ledger === 'string'
  ? args.ledger.toLowerCase()
  : null;
const forcedMode = ledgerFlag === 'on' || ledgerFlag === 'true'
  ? 'current'
  : ledgerFlag === 'off' || ledgerFlag === 'false'
    ? 'baseline'
    : null;
const mode = forcedMode || (['baseline', 'current', 'compare'].includes(String(args.mode))
  ? String(args.mode)
  : 'compare');

const indexDir = resolveIndexDir(root, args);
let artifacts = null;
if (indexDir) {
  artifacts = await loadArtifacts(indexDir);
}
if (!artifacts) {
  artifacts = buildSyntheticArtifacts({
    chunkCount,
    fileCount,
    importsPerFile,
    edgesPerNode,
    seed
  });
}

console.log(`[bench] source=${artifacts.source} mode=${mode}`);

let baseline = null;
if (mode !== 'current') {
  baseline = runOnce({
    label: 'baseline',
    hash: false,
    ...artifacts
  });
  printResult(baseline);
}
if (mode !== 'baseline') {
  const current = runOnce({
    label: 'current',
    hash: true,
    ...artifacts
  });
  printResult(current);
  if (baseline) {
    printDelta(baseline, current);
  }
}
