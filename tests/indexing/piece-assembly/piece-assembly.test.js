#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { DEFAULT_TEST_ENV_KEYS, syncProcessEnv } from '../../helpers/test-env.js';
import { loadChunkMeta, loadTokenPostings } from '../../../src/shared/artifact-io.js';
import { stableStringify } from '../../../src/shared/stable-json.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const buildIndexPath = path.join(root, 'build_index.js');
const assemblePath = path.join(root, 'tools', 'assemble-pieces.js');

if (!fs.existsSync(fixtureRoot)) {
  console.error(`Missing fixture: ${fixtureRoot}`);
  process.exit(1);
}

const cacheRoot = path.join(root, '.testCache', 'piece-assembly');
const cacheA = path.join(cacheRoot, 'a');
const cacheB = path.join(cacheRoot, 'b');
const outputMono = path.join(cacheRoot, 'assembled-single', 'index-code');
const outputDir = path.join(cacheRoot, 'assembled', 'index-code');
const outputDir2 = path.join(cacheRoot, 'assembled-repeat', 'index-code');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const baseEnv = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_EMBEDDINGS: 'stub',
  PAIROFCLEATS_TEST_CONFIG: JSON.stringify({
    tooling: { autoEnableOnDetect: false }
  })
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

const run = (label, args, env) => {
  const result = spawnSync(process.execPath, args, {
    cwd: fixtureRoot,
    env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

run('build_index (A)', [buildIndexPath, '--stub-embeddings', '--scm-provider', 'none', '--mode', 'code', '--repo', fixtureRoot], {
  ...baseEnv,
  PAIROFCLEATS_CACHE_ROOT: cacheA
});
run('build_index (B)', [buildIndexPath, '--stub-embeddings', '--scm-provider', 'none', '--mode', 'code', '--repo', fixtureRoot], {
  ...baseEnv,
  PAIROFCLEATS_CACHE_ROOT: cacheB
});

const userConfig = loadUserConfig(fixtureRoot);
process.env.PAIROFCLEATS_CACHE_ROOT = cacheA;
const indexA = getIndexDir(fixtureRoot, 'code', userConfig);
process.env.PAIROFCLEATS_CACHE_ROOT = cacheB;
const indexB = getIndexDir(fixtureRoot, 'code', userConfig);

run('assemble-pieces (single)', [
  assemblePath,
  '--repo',
  fixtureRoot,
  '--mode',
  'code',
  '--out',
  outputMono,
  '--input',
  indexA,
  '--force'
], {
  ...baseEnv,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot
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

run('assemble-pieces (repeat)', [
  assemblePath,
  '--repo',
  fixtureRoot,
  '--mode',
  'code',
  '--out',
  outputDir2,
  '--input',
  indexA,
  '--input',
  indexB,
  '--force'
], {
  ...baseEnv,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot
});

const chunksOutRepeat = await loadChunkMeta(outputDir2);
if (stableStringify(chunksOutRepeat) !== stableStringify(chunksOutList)) {
  console.error('Repeat assembly produced different chunk_meta output.');
  process.exit(1);
}
const tokenIndexRepeat = loadTokenPostings(outputDir2);
if (serializeTokenIndex(tokenIndexRepeat) !== serializeTokenIndex(tokenIndex)) {
  console.error('Repeat assembly produced different token_postings output.');
  process.exit(1);
}

const manifestPath = path.join(outputDir, 'pieces', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`Missing pieces manifest: ${manifestPath}`);
  process.exit(1);
}

const equivalenceRoot = path.join(cacheRoot, 'equivalence');
const repoAll = path.join(equivalenceRoot, 'repo-all');
const repoA = path.join(equivalenceRoot, 'repo-a');
const repoB = path.join(equivalenceRoot, 'repo-b');
const cacheAll = path.join(equivalenceRoot, 'cache-all');
const cacheA2 = path.join(equivalenceRoot, 'cache-a');
const cacheB2 = path.join(equivalenceRoot, 'cache-b');
const assembledEquiv = path.join(equivalenceRoot, 'assembled', 'index-code');

await fsPromises.rm(equivalenceRoot, { recursive: true, force: true });
await fsPromises.mkdir(equivalenceRoot, { recursive: true });

const sampleSrc = path.join(fixtureRoot, 'src');
const sampleFiles = (await fsPromises.readdir(sampleSrc))
  .filter((file) => file.endsWith('.js'))
  .sort();
if (sampleFiles.length < 2) {
  console.error('Piece assembly equivalence test requires at least two sample files.');
  process.exit(1);
}
const splitIndex = Math.max(1, Math.floor(sampleFiles.length / 2));
const filesA = sampleFiles.slice(0, splitIndex);
const filesB = sampleFiles.slice(splitIndex);

const copyRepoFiles = async (destRoot, files) => {
  const destSrc = path.join(destRoot, 'src');
  await fsPromises.mkdir(destSrc, { recursive: true });
  for (const file of files) {
    const sourcePath = path.join(sampleSrc, file);
    const destPath = path.join(destSrc, file);
    await fsPromises.copyFile(sourcePath, destPath);
  }
};

await copyRepoFiles(repoAll, sampleFiles);
await copyRepoFiles(repoA, filesA);
await copyRepoFiles(repoB, filesB);

run('build_index (monolithic)', [buildIndexPath, '--stub-embeddings', '--scm-provider', 'none', '--mode', 'code', '--repo', repoAll], {
  ...baseEnv,
  PAIROFCLEATS_CACHE_ROOT: cacheAll
});
run('build_index (part A)', [buildIndexPath, '--stub-embeddings', '--scm-provider', 'none', '--mode', 'code', '--repo', repoA], {
  ...baseEnv,
  PAIROFCLEATS_CACHE_ROOT: cacheA2
});
run('build_index (part B)', [buildIndexPath, '--stub-embeddings', '--scm-provider', 'none', '--mode', 'code', '--repo', repoB], {
  ...baseEnv,
  PAIROFCLEATS_CACHE_ROOT: cacheB2
});

const userConfigAll = loadUserConfig(repoAll);
process.env.PAIROFCLEATS_CACHE_ROOT = cacheAll;
const indexAll = getIndexDir(repoAll, 'code', userConfigAll);
process.env.PAIROFCLEATS_CACHE_ROOT = cacheA2;
const indexA2 = getIndexDir(repoA, 'code', loadUserConfig(repoA));
process.env.PAIROFCLEATS_CACHE_ROOT = cacheB2;
const indexB2 = getIndexDir(repoB, 'code', loadUserConfig(repoB));

const assembleEquivStart = Date.now();
run('assemble-pieces (equivalence)', [
  assemblePath,
  '--repo',
  repoAll,
  '--mode',
  'code',
  '--out',
  assembledEquiv,
  '--input',
  indexA2,
  '--input',
  indexB2,
  '--force'
], {
  ...baseEnv,
  PAIROFCLEATS_CACHE_ROOT: equivalenceRoot
});
const assembleEquivDuration = Date.now() - assembleEquivStart;
if (assembleEquivDuration > 30000) {
  console.error(`assemble-pieces (equivalence) took too long (${assembleEquivDuration}ms).`);
  process.exit(1);
}

const chunksAll = await loadChunkMeta(indexAll);
const chunksEquiv = await loadChunkMeta(assembledEquiv);
if (stableStringify(normalizeChunks(chunksAll)) !== stableStringify(normalizeChunks(chunksEquiv))) {
  const normalizedAll = normalizeChunks(chunksAll);
  const normalizedEquiv = normalizeChunks(chunksEquiv);
  const limit = Math.min(normalizedAll.length, normalizedEquiv.length);
  for (let i = 0; i < limit; i += 1) {
    if (stableStringify(normalizedAll[i]) !== stableStringify(normalizedEquiv[i])) {
      logChunkMetaDiff('equivalence chunk_meta', normalizedAll[i], normalizedEquiv[i]);
      break;
    }
  }
  console.error('Piece assembly equivalence failed: chunk_meta mismatch.');
  process.exit(1);
}

const postingsAll = loadTokenPostings(indexAll);
const postingsEquiv = loadTokenPostings(assembledEquiv);
if (stableStringify(postingsAll) !== stableStringify(postingsEquiv)) {
  console.error('Piece assembly equivalence failed: token_postings mismatch.');
  process.exit(1);
}

const manifestAll = JSON.parse(await fsPromises.readFile(path.join(indexAll, 'pieces', 'manifest.json'), 'utf8'));
const manifestEquiv = JSON.parse(await fsPromises.readFile(path.join(assembledEquiv, 'pieces', 'manifest.json'), 'utf8'));
const piecesAll = Array.isArray(manifestAll.pieces) ? manifestAll.pieces : [];
const piecesEquiv = Array.isArray(manifestEquiv.pieces) ? manifestEquiv.pieces : [];
const normalizePiece = (entry) => {
  if (!entry || typeof entry !== 'object') return entry;
  const normalized = { ...entry };
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
  || entry?.name === 'risk_interprocedural_stats'
));
const normalizedAll = sortPieces(stripManifestEntries(piecesAll).map(normalizePiece));
const normalizedEquiv = sortPieces(stripManifestEntries(piecesEquiv).map(normalizePiece));
if (stableStringify(normalizedAll) !== stableStringify(normalizedEquiv)) {
  console.error('Piece assembly equivalence failed: pieces manifest mismatch.');
  process.exit(1);
}

const graphAll = JSON.parse(
  await fsPromises.readFile(path.join(indexAll, 'graph_relations.json'), 'utf8')
);
const graphEquiv = JSON.parse(
  await fsPromises.readFile(path.join(assembledEquiv, 'graph_relations.json'), 'utf8')
);
delete graphAll.generatedAt;
delete graphEquiv.generatedAt;
if (JSON.stringify(graphAll) !== JSON.stringify(graphEquiv)) {
  console.error('Piece assembly equivalence failed: graph_relations mismatch.');
  process.exit(1);
}

console.log('Piece assembly tests passed');

