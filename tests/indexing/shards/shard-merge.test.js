#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { MAX_JSON_BYTES, loadChunkMeta, loadTokenPostings } from '../../../src/shared/artifact-io.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { rmDirRecursive } from '../../helpers/temp.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'shard-merge');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRootA = path.join(tempRoot, 'cache-a');
const cacheRootB = path.join(tempRoot, 'cache-b');

await rmDirRecursive(tempRoot);
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(path.join(repoRoot, 'lib'), { recursive: true });
await fsPromises.mkdir(cacheRootA, { recursive: true });
await fsPromises.mkdir(cacheRootB, { recursive: true });
applyTestEnv();

await fsPromises.writeFile(path.join(repoRoot, 'src', 'alpha.js'), 'export const alpha = 1;\n');
await fsPromises.writeFile(path.join(repoRoot, 'lib', 'beta.py'), 'def beta():\n  return 2\n');

const runBuild = (cacheRoot, label, testConfig) => {
  const env = {
    ...process.env,    ...(testConfig ? { PAIROFCLEATS_TEST_CONFIG: JSON.stringify(testConfig) } : {}),
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_EMBEDDINGS: 'stub'
  };
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'build_index.js'), '--stub-embeddings', '--scm-provider', 'none', '--repo', repoRoot],
    { cwd: repoRoot, env, stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

const readIndex = async (cacheRoot) => {
  const previousCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;
  process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
  const userConfig = loadUserConfig(repoRoot);
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  const chunks = await loadChunkMeta(codeDir, { maxBytes: MAX_JSON_BYTES });
  const tokenIndex = loadTokenPostings(codeDir, { maxBytes: MAX_JSON_BYTES });
  if (previousCacheRoot === undefined) {
    delete process.env.PAIROFCLEATS_CACHE_ROOT;
  } else {
    process.env.PAIROFCLEATS_CACHE_ROOT = previousCacheRoot;
  }
  return { chunks, tokenIndex };
};

const readManifest = async (cacheRoot) => {
  const previousCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;
  process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
  const userConfig = loadUserConfig(repoRoot);
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  const manifestPath = path.join(codeDir, 'pieces', 'manifest.json');
  const raw = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
  if (previousCacheRoot === undefined) {
    delete process.env.PAIROFCLEATS_CACHE_ROOT;
  } else {
    process.env.PAIROFCLEATS_CACHE_ROOT = previousCacheRoot;
  }
  return raw;
};

const normalizeChunk = (chunk) => {
  const copy = JSON.parse(JSON.stringify(chunk));
  const tooling = copy?.docmeta?.tooling;
  if (tooling?.sources && Array.isArray(tooling.sources)) {
    tooling.sources = tooling.sources.map(({ collectedAt, ...rest }) => rest);
    if (!tooling.sources.length) {
      delete copy.docmeta.tooling;
    }
  }
  return copy;
};

const resolveCodeDir = (cacheRoot) => {
  const previousCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;
  process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
  const userConfig = loadUserConfig(repoRoot);
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  if (previousCacheRoot === undefined) {
    delete process.env.PAIROFCLEATS_CACHE_ROOT;
  } else {
    process.env.PAIROFCLEATS_CACHE_ROOT = previousCacheRoot;
  }
  return codeDir;
};

const loadPieceJson = async (cacheRoot, piecePath) => {
  const codeDir = resolveCodeDir(cacheRoot);
  const fullPath = path.join(codeDir, piecePath);
  if (!fs.existsSync(fullPath)) return { path: fullPath, json: null };
  const raw = await fsPromises.readFile(fullPath, 'utf8');
  if (piecePath.endsWith('.jsonl')) {
    const rows = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    return { path: fullPath, json: rows };
  }
  return { path: fullPath, json: JSON.parse(raw) };
};

const normalizeGraphRelations = (value) => {
  if (!value || typeof value !== 'object') return value;
  if (!('generatedAt' in value)) return value;
  return { ...value, generatedAt: '__normalized__' };
};

const graphRelationsEquivalent = (left, right) => (
  stableStringify(normalizeGraphRelations(left)) === stableStringify(normalizeGraphRelations(right))
);

const normalizeGeneratedAt = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeGeneratedAt(entry));
  }
  if (!value || typeof value !== 'object') return value;
  const copy = { ...value };
  if ('generatedAt' in copy) copy.generatedAt = '__normalized__';
  if ('updatedAt' in copy) copy.updatedAt = '__normalized__';
  for (const [key, entry] of Object.entries(copy)) {
    if (key === 'generatedAt' || key === 'updatedAt') continue;
    if (entry && typeof entry === 'object') {
      copy[key] = normalizeGeneratedAt(entry);
    }
  }
  return copy;
};

const generatedAtEquivalent = (left, right) => (
  stableStringify(normalizeGeneratedAt(left)) === stableStringify(normalizeGeneratedAt(right))
);

const normalizeRiskInterproceduralStats = (value) => {
  if (!value || typeof value !== 'object') return value;
  const copy = normalizeGeneratedAt(value);
  if (copy && typeof copy === 'object' && copy.timingMs && typeof copy.timingMs === 'object') {
    const timing = { ...copy.timingMs };
    for (const key of Object.keys(timing)) {
      timing[key] = '__normalized__';
    }
    copy.timingMs = timing;
  }
  return copy;
};

const riskInterproceduralEquivalent = (left, right) => (
  stableStringify(normalizeRiskInterproceduralStats(left))
    === stableStringify(normalizeRiskInterproceduralStats(right))
);

const normalizeIndexState = (value) => {
  if (!value || typeof value !== 'object') return value;
  const volatileKeys = new Set(['generatedAt', 'updatedAt', 'buildId', 'repoId', 'path']);
  const stripVolatile = (node) => {
    if (Array.isArray(node)) return node.map((entry) => stripVolatile(entry));
    if (!node || typeof node !== 'object') return node;
    const next = {};
    for (const [key, entry] of Object.entries(node)) {
      if (volatileKeys.has(key)) continue;
      next[key] = stripVolatile(entry);
    }
    return next;
  };
  const copy = stripVolatile(JSON.parse(JSON.stringify(value)));
  delete copy.shards;
  delete copy.compatibilityKey;
  if (copy.embeddings && typeof copy.embeddings === 'object') {
    delete copy.embeddings.lastError;
    if (copy.embeddings.backends && typeof copy.embeddings.backends === 'object') {
      for (const backend of Object.values(copy.embeddings.backends)) {
        if (!backend || typeof backend !== 'object') continue;
        delete backend.available;
        delete backend.enabled;
        delete backend.target;
        delete backend.dims;
        delete backend.count;
      }
    }
  }
  if (copy.sqlite && typeof copy.sqlite === 'object') {
    delete copy.sqlite.stats;
    delete copy.sqlite.note;
    delete copy.sqlite.threadLimits;
    delete copy.sqlite.elapsedMs;
    delete copy.sqlite.bytes;
    delete copy.sqlite.inputBytes;
    delete copy.sqlite.status;
    delete copy.sqlite.error;
  }
  if (copy.lmdb && typeof copy.lmdb === 'object') {
    delete copy.lmdb.mapSizeBytes;
    delete copy.lmdb.mapSizeEstimatedBytes;
    delete copy.lmdb.pending;
    delete copy.lmdb.ready;
    delete copy.lmdb.error;
  }
  return copy;
};

const indexStateEquivalent = (left, right) => (
  stableStringify(normalizeIndexState(left)) === stableStringify(normalizeIndexState(right))
);

const findFirstDiff = (left, right, currentPath = []) => {
  if (left === right) return null;
  const leftType = Array.isArray(left) ? 'array' : (left === null ? 'null' : typeof left);
  const rightType = Array.isArray(right) ? 'array' : (right === null ? 'null' : typeof right);
  if (leftType !== rightType) {
    return { path: currentPath, left, right, note: `type ${leftType} vs ${rightType}` };
  }
  if (leftType === 'array') {
    if (left.length !== right.length) {
      return { path: [...currentPath, 'length'], left: left.length, right: right.length };
    }
    for (let i = 0; i < left.length; i += 1) {
      const diff = findFirstDiff(left[i], right[i], [...currentPath, String(i)]);
      if (diff) return diff;
    }
    return null;
  }
  if (leftType === 'object') {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length || leftKeys.join('|') !== rightKeys.join('|')) {
      return { path: [...currentPath, 'keys'], left: leftKeys, right: rightKeys };
    }
    for (const key of leftKeys) {
      const diff = findFirstDiff(left[key], right[key], [...currentPath, key]);
      if (diff) return diff;
    }
    return null;
  }
  return { path: currentPath, left, right };
};

const logPieceDiff = async (piecePath) => {
  try {
    const base = await loadPieceJson(cacheRootA, piecePath);
    const shard = await loadPieceJson(cacheRootB, piecePath);
    if (!base.json || !shard.json) {
      console.error(`Shard merge diff: missing ${piecePath} (${base.path}, ${shard.path})`);
      return;
    }
    const leftJson = piecePath === 'index_state.json' ? normalizeIndexState(base.json) : base.json;
    const rightJson = piecePath === 'index_state.json' ? normalizeIndexState(shard.json) : shard.json;
    const diff = findFirstDiff(leftJson, rightJson);
    if (!diff) {
      console.error(`Shard merge diff: ${piecePath} parsed equal despite checksum mismatch.`);
      return;
    }
    console.error(`Shard merge diff: ${piecePath} @ ${diff.path.join('.') || '(root)'}`);
    console.error('  left:', JSON.stringify(diff.left));
    console.error('  right:', JSON.stringify(diff.right));
    if (diff.note) console.error(`  note: ${diff.note}`);
  } catch (err) {
    console.error(`Shard merge diff: failed to compare ${piecePath}: ${err?.message || err}`);
  }
};

runBuild(cacheRootA, 'baseline build', {
  indexing: {
    fileListSampleSize: 10,
    shards: { enabled: false },
    treeSitter: { enabled: false }
  },
  tooling: {
    autoEnableOnDetect: false
  }
});
const baseline = await readIndex(cacheRootA);
const baselineManifest = await readManifest(cacheRootA);

runBuild(cacheRootB, 'sharded build', {
  indexing: {
    fileListSampleSize: 10,
    shards: {
      enabled: true,
      maxWorkers: 1,
      minFiles: 1
    },
    treeSitter: { enabled: false }
  },
  tooling: {
    autoEnableOnDetect: false
  }
});
const sharded = await readIndex(cacheRootB);
const shardedManifest = await readManifest(cacheRootB);

if (baseline.chunks.length !== sharded.chunks.length) {
  console.error('Shard merge mismatch: chunk counts differ');
  process.exit(1);
}
const normalizedBaseline = baseline.chunks.map(normalizeChunk);
const normalizedSharded = sharded.chunks.map(normalizeChunk);
if (stableStringify(normalizedBaseline) !== stableStringify(normalizedSharded)) {
  console.error('Shard merge mismatch: chunk metadata differs');
  process.exit(1);
}
if (JSON.stringify(baseline.tokenIndex.vocab) !== JSON.stringify(sharded.tokenIndex.vocab)) {
  console.error('Shard merge mismatch: token vocab differs');
  process.exit(1);
}
if (JSON.stringify(baseline.tokenIndex.postings) !== JSON.stringify(sharded.tokenIndex.postings)) {
  console.error('Shard merge mismatch: token postings differ');
  process.exit(1);
}

const normalizeManifest = (manifest) => {
  const pieces = Array.isArray(manifest?.pieces) ? manifest.pieces : [];
  const map = new Map();
  for (const entry of pieces) {
    if (!entry?.path) continue;
    map.set(entry.path, entry);
  }
  return map;
};

const baselinePieces = normalizeManifest(baselineManifest);
const shardedPieces = normalizeManifest(shardedManifest);
if (baselinePieces.size !== shardedPieces.size) {
  console.error('Shard merge mismatch: pieces manifest counts differ');
  process.exit(1);
}
for (const [piecePath, baselineEntry] of baselinePieces.entries()) {
  if (piecePath === '.filelists.json') continue;
  if (piecePath.endsWith('import_resolution_graph.json')) continue;
  const shardedEntry = shardedPieces.get(piecePath);
  if (!shardedEntry) {
    console.error(`Shard merge mismatch: missing piece entry ${piecePath}`);
    process.exit(1);
  }
  const isDir = baselineEntry?.format === 'dir' || shardedEntry?.format === 'dir';
  if (isDir) {
    continue;
  }
  if (!baselineEntry.checksum || !baselineEntry.checksum.includes(':')) {
    console.error(`Shard merge mismatch: baseline checksum missing for ${piecePath}`);
    process.exit(1);
  }
  if (!shardedEntry.checksum || !shardedEntry.checksum.includes(':')) {
    console.error(`Shard merge mismatch: sharded checksum missing for ${piecePath}`);
    process.exit(1);
  }
  if (baselineEntry.checksum !== shardedEntry.checksum) {
    if (piecePath === 'graph_relations.json' || piecePath === 'graph_relations.meta.json') {
      const base = await loadPieceJson(cacheRootA, piecePath);
      const shard = await loadPieceJson(cacheRootB, piecePath);
      if (base.json && shard.json && graphRelationsEquivalent(base.json, shard.json)) {
        continue;
      }
    }
    if (piecePath === 'index_state.json') {
      const base = await loadPieceJson(cacheRootA, piecePath);
      const shard = await loadPieceJson(cacheRootB, piecePath);
      if (base.json && shard.json && indexStateEquivalent(base.json, shard.json)) {
        continue;
      }
    }
    if (piecePath === 'risk_interprocedural_stats.json') {
      const base = await loadPieceJson(cacheRootA, piecePath);
      const shard = await loadPieceJson(cacheRootB, piecePath);
      if (base.json && shard.json && riskInterproceduralEquivalent(base.json, shard.json)) {
        continue;
      }
    }
    {
      const base = await loadPieceJson(cacheRootA, piecePath);
      const shard = await loadPieceJson(cacheRootB, piecePath);
      if (base.json && shard.json && generatedAtEquivalent(base.json, shard.json)) {
        continue;
      }
    }
    await logPieceDiff(piecePath);
    console.error(`Shard merge mismatch: checksum differs for ${piecePath}`);
    process.exit(1);
  }
}

console.log('shard merge test passed');

