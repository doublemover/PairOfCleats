#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv, DEFAULT_TEST_ENV_KEYS, syncProcessEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { rmDirRecursive } from '../../helpers/temp.js';
import { loadChunkMeta, loadGraphRelationsSync, loadTokenPostings } from '../../../src/shared/artifact-io.js';
import { assembleIndexPieces } from '../../../src/index/build/piece-assembly.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { loadPiecesManifestPieces, resolvePiecesManifestPath } from '../../helpers/pieces-manifest.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const buildIndexPath = path.join(root, 'build_index.js');
const assemblePath = path.join(root, 'tools', 'index', 'assemble-pieces.js');

const cacheRoot = resolveTestCachePath(root, 'piece-assembly');
const fixtureRoot = path.join(cacheRoot, 'source-repo');
const cacheA = path.join(cacheRoot, 'a');
const cacheB = path.join(cacheRoot, 'b');
const outputMono = path.join(cacheRoot, 'assembled-single', 'index-code');
const outputDir = path.join(cacheRoot, 'assembled', 'index-code');

await rmDirRecursive(cacheRoot, { retries: 8, delayMs: 150 });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
await fsPromises.writeFile(
  path.join(fixtureRoot, 'src', 'alpha.js'),
  [
    'export function alpha(value = 1) {',
    '  return value + 1;',
    '}',
    ''
  ].join('\n'),
  'utf8'
);
await fsPromises.writeFile(
  path.join(fixtureRoot, 'src', 'beta.js'),
  [
    'import { alpha } from "./alpha.js";',
    'export function beta() {',
    '  return alpha(2);',
    '}',
    ''
  ].join('\n'),
  'utf8'
);
await fsPromises.writeFile(
  path.join(fixtureRoot, 'src', 'gamma.js'),
  [
    'import { beta } from "./beta.js";',
    'export const gamma = () => beta();',
    ''
  ].join('\n'),
  'utf8'
);
await fsPromises.writeFile(
  path.join(fixtureRoot, 'README.md'),
  '# Piece assembly fixture\n\nsmall synthetic fixture\n',
  'utf8'
);

const baseEnv = {
  ...process.env,  PAIROFCLEATS_EMBEDDINGS: 'stub',
  PAIROFCLEATS_TEST_CONFIG: JSON.stringify({
    indexing: {
      scm: { provider: 'none' },
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false
    },
    tooling: {
      autoEnableOnDetect: false,
      lsp: { enabled: false }
    }
  }),
  PAIROFCLEATS_WORKER_POOL: 'off'
};
syncProcessEnv(baseEnv, [...DEFAULT_TEST_ENV_KEYS]);

const logChunkMetaDiff = (label, left, right) => {
  if (!left || !right) return;
  const id = left.chunkId || left.metaV2?.chunkId || null;
  const file = left.file || right.file || left.metaV2?.file || right.metaV2?.file || null;
  const name = left.name || right.name || left.metaV2?.name || right.metaV2?.name || null;
  console.error(`[piece-assembly] ${label} mismatch for ${file || 'unknown'} (${name || 'unknown'}, ${id || 'unknown'}).`);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of Array.from(keys).sort()) {
    const a = left[key];
    const b = right[key];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (key === 'metaV2') {
      const metaKeys = new Set([
        ...Object.keys(a || {}),
        ...Object.keys(b || {})
      ]);
      for (const metaKey of Array.from(metaKeys).sort()) {
        const av = a?.[metaKey];
        const bv = b?.[metaKey];
        if (JSON.stringify(av) === JSON.stringify(bv)) continue;
        console.error(`[piece-assembly] metaV2.${metaKey} diff`, { a: av, b: bv });
      }
      continue;
    }
    console.error(`[piece-assembly] ${key} diff`, { a, b });
  }
};

const run = (label, args, env, cwd = fixtureRoot) => {
  const result = runNode(args, label, cwd, env, {
    stdio: 'inherit',
    allowFailure: true
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

const assembleDirect = async ({ inputs, outDir, repoRoot, userConfig, env, label }) => {
  await rmDirRecursive(outDir, { retries: 8, delayMs: 150 });
  await fsPromises.mkdir(outDir, { recursive: true });
  syncProcessEnv(env, [...DEFAULT_TEST_ENV_KEYS]);
  try {
    await assembleIndexPieces({
      inputs,
      outDir,
      root: repoRoot,
      mode: 'code',
      userConfig,
      strict: true,
      log: () => {}
    });
  } catch (err) {
    console.error(`Failed: ${label}`);
    console.error(err?.stack || err?.message || err);
    process.exit(1);
  }
};

const buildCodeArgs = (repoRoot) => [
  buildIndexPath,
  '--stub-embeddings',
  '--stage',
  'stage1',
  '--scm-provider',
  'none',
  '--mode',
  'code',
  '--repo',
  repoRoot
];

run('build_index (A)', buildCodeArgs(fixtureRoot), {
  ...baseEnv,
  PAIROFCLEATS_CACHE_ROOT: cacheA
});
await fsPromises.cp(cacheA, cacheB, { recursive: true });

const userConfig = loadUserConfig(fixtureRoot);
process.env.PAIROFCLEATS_CACHE_ROOT = cacheA;
const indexA = getIndexDir(fixtureRoot, 'code', userConfig);
process.env.PAIROFCLEATS_CACHE_ROOT = cacheB;
const indexB = getIndexDir(fixtureRoot, 'code', userConfig);

await assembleDirect({
  inputs: [indexA],
  outDir: outputMono,
  repoRoot: fixtureRoot,
  userConfig,
  env: {
    ...baseEnv,
    PAIROFCLEATS_CACHE_ROOT: cacheRoot
  },
  label: 'assemble-pieces direct (single)'
});

const assembleStart = Date.now();
run('assemble-pieces (merge)', [
  assemblePath,
  '--repo',
  fixtureRoot,
  '--mode',
  'code',
  '--out',
  outputDir,
  '--input',
  indexA,
  '--input',
  indexB,
  '--force'
], {
  ...baseEnv,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot
});
const assembleDuration = Date.now() - assembleStart;
if (assembleDuration > 30000) {
  console.error(`assemble-pieces took too long (${assembleDuration}ms).`);
  process.exit(1);
}

const serializeTokenIndex = (tokenIndex) => JSON.stringify({
  vocab: tokenIndex?.vocab || [],
  postings: tokenIndex?.postings || [],
  docLengths: tokenIndex?.docLengths || []
});

const chunksAList = await loadChunkMeta(indexA);
const chunksA = chunksAList.length;
const chunksB = (await loadChunkMeta(indexB)).length;
const chunksOutList = await loadChunkMeta(outputDir);
const chunksOut = chunksOutList.length;
if (chunksOut !== chunksA + chunksB) {
  console.error(`Expected merged chunk count ${chunksA + chunksB}, got ${chunksOut}`);
  process.exit(1);
}

const chunksMonoList = await loadChunkMeta(outputMono);
const normalizeChunks = (chunks) => (
  Array.isArray(chunks)
    ? chunks.map((chunk) => {
      if (!chunk || typeof chunk !== 'object') return chunk;
      if (!chunk.metaV2 || typeof chunk.metaV2 !== 'object') return chunk;
      const metaV2 = { ...chunk.metaV2 };
      delete metaV2.relations;
      delete metaV2.usages;
      return { ...chunk, metaV2 };
    })
    : chunks
);
const normalizedA = normalizeChunks(chunksAList);
const normalizedMono = normalizeChunks(chunksMonoList);
if (stableStringify(normalizedMono) !== stableStringify(normalizedA)) {
  const limit = Math.min(normalizedA.length, normalizedMono.length);
  for (let i = 0; i < limit; i += 1) {
    if (stableStringify(normalizedA[i]) !== stableStringify(normalizedMono[i])) {
      logChunkMetaDiff('chunk_meta', normalizedA[i], normalizedMono[i]);
      break;
    }
  }
  console.error('Assembled single index does not match monolithic chunk_meta.');
  process.exit(1);
}

const tokenMono = loadTokenPostings(indexA);
const tokenSingle = loadTokenPostings(outputMono);
if (serializeTokenIndex(tokenMono) !== serializeTokenIndex(tokenSingle)) {
  console.error('Assembled single index does not match monolithic token_postings.');
  process.exit(1);
}

const tokenIndex = loadTokenPostings(outputDir);
if (!Array.isArray(tokenIndex?.docLengths) || tokenIndex.docLengths.length !== chunksOut) {
  console.error('Merged token_postings docLengths mismatch.');
  process.exit(1);
}
if (!Array.isArray(tokenIndex?.vocab) || !Array.isArray(tokenIndex?.postings)) {
  console.error('Merged token_postings missing vocab/postings.');
  process.exit(1);
}
if (tokenIndex.vocab.length !== tokenIndex.postings.length) {
  console.error('Merged token_postings vocab/postings length mismatch.');
  process.exit(1);
}
let minDocId = Number.POSITIVE_INFINITY;
let maxDocId = -1;
for (const posting of tokenIndex.postings) {
  if (!Array.isArray(posting)) continue;
  for (const entry of posting) {
    if (!Array.isArray(entry)) continue;
    const docId = entry[0];
    if (!Number.isFinite(docId)) continue;
    if (docId < minDocId) minDocId = docId;
    if (docId > maxDocId) maxDocId = docId;
  }
}
if (maxDocId < chunksA || maxDocId >= chunksOut) {
  console.error('Merged token_postings docIds not offset correctly.');
  process.exit(1);
}
if (minDocId < 0) {
  console.error('Merged token_postings docIds should be non-negative.');
  process.exit(1);
}

const manifestPath = resolvePiecesManifestPath(outputDir);
if (!fs.existsSync(manifestPath)) {
  console.error(`Missing pieces manifest: ${manifestPath}`);
  process.exit(1);
}

const piecesAll = loadPiecesManifestPieces(indexA);
const piecesOut = loadPiecesManifestPieces(outputDir);
const normalizePiece = (entry) => {
  if (!entry || typeof entry !== 'object') return entry;
  const normalized = { ...entry };
  delete normalized.tier;
  delete normalized.layout;
  if (normalized.statError == null) delete normalized.statError;
  if (normalized.checksumError == null) delete normalized.checksumError;
  if (normalized.bytes == null || Number.isFinite(normalized.bytes)) delete normalized.bytes;
  if (normalized.checksum == null || typeof normalized.checksum === 'string') delete normalized.checksum;
  if (normalized.mtime == null || Number.isFinite(normalized.mtime)) delete normalized.mtime;
  return normalized;
};
const sortPieces = (pieces) => pieces.slice().sort((a, b) => {
  const nameA = `${a?.name || ''}`;
  const nameB = `${b?.name || ''}`;
  if (nameA !== nameB) return nameA.localeCompare(nameB);
  const pathA = `${a?.path || ''}`;
  const pathB = `${b?.path || ''}`;
  if (pathA !== pathB) return pathA.localeCompare(pathB);
  const typeA = `${a?.type || ''}`;
  const typeB = `${b?.type || ''}`;
  return typeA.localeCompare(typeB);
});
const stripManifestEntries = (pieces) => pieces.filter((entry) => !(
  (entry?.type === 'stats' && entry?.name === 'filelists')
  || (entry?.type === 'stats' && entry?.name === 'index_state')
  || (entry?.type === 'relations' && entry?.name === 'graph_relations')
  || (entry?.type === 'relations' && entry?.name === 'graph_relations_meta')
  || (entry?.type === 'relations' && entry?.name === 'graph_relations_offsets')
  || (entry?.type === 'relations' && entry?.name === 'graph_relations_csr')
  || entry?.name === 'import_resolution_graph'
  || entry?.name === 'dense_vectors_hnsw_meta'
  || entry?.name === 'dense_vectors_lancedb_meta'
  || entry?.name === 'dense_vectors_code_hnsw_meta'
  || entry?.name === 'dense_vectors_doc_hnsw_meta'
  || entry?.name === 'dense_vectors_code_lancedb_meta'
  || entry?.name === 'dense_vectors_doc_lancedb_meta'
  || entry?.name === 'dense_vectors_hnsw'
  || entry?.name === 'dense_vectors_lancedb'
  || entry?.name === 'dense_vectors_code_hnsw'
  || entry?.name === 'dense_vectors_doc_hnsw'
  || entry?.name === 'dense_vectors_code_lancedb'
  || entry?.name === 'dense_vectors_doc_lancedb'
  || entry?.name === 'vfs_manifest'
  || entry?.name === 'vfs_manifest_bloom'
  || entry?.name === 'vfs_manifest_index'
  || entry?.name === 'lexicon_relation_filter_report'
  || entry?.name === 'risk_interprocedural_stats'
));
const normalizedAll = sortPieces(stripManifestEntries(piecesAll).map(normalizePiece));
const normalizedOut = sortPieces(stripManifestEntries(piecesOut).map(normalizePiece));
if (!normalizedAll.length || !normalizedOut.length) {
  console.error('Piece assembly produced an empty comparable pieces manifest.');
  process.exit(1);
}

const graphAll = loadGraphRelationsSync(indexA);
const graphOut = loadGraphRelationsSync(outputDir);
delete graphAll.generatedAt;
delete graphOut.generatedAt;
if (!graphOut || typeof graphOut !== 'object') {
  console.error('Piece assembly merge produced missing graph_relations output.');
  process.exit(1);
}

console.log('Piece assembly tests passed');

