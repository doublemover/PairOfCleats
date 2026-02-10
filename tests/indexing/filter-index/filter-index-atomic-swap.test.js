#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildPostings } from '../../../src/index/build/postings.js';
import { writeIndexArtifacts } from '../../../src/index/build/artifacts.js';
import { fromPosix } from '../../../src/shared/files.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const root = process.cwd();
const testRoot = path.join(root, '.testCache', 'filter-index-atomic-swap');
const outDir = path.join(testRoot, 'index-code');

await fsPromises.rm(testRoot, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });
applyTestEnv({ testing: '1' });

const baseState = {
  chunks: [],
  discoveredFiles: [],
  scannedFilesTimes: [],
  scannedFiles: [],
  skippedFiles: [],
  totalTokens: 0,
  fileRelations: new Map(),
  fileInfoByPath: new Map(),
  fileDetailsByPath: new Map(),
  chunkUidToFile: new Map(),
  docLengths: [],
  vfsManifestRows: [],
  vfsManifestCollector: null,
  fieldTokens: [],
  importResolutionGraph: null
};

const makeChunk = (overrides) => ({
  id: 0,
  file: 'src/a.js',
  ext: '.js',
  lang: 'javascript',
  chunkUid: 'chunk-0',
  start: 0,
  end: 1,
  startLine: 1,
  endLine: 1,
  kind: 'FunctionDeclaration',
  name: 'alpha',
  docmeta: { signature: '(a)' },
  metaV2: { effective: { languageId: 'javascript' } },
  ...overrides
});

const runWrite = async ({ chunks, indexState }) => {
  const state = {
    ...baseState,
    chunks,
    discoveredFiles: Array.from(new Set(chunks.map((c) => c.file).filter(Boolean))),
    docLengths: chunks.map(() => 0)
  };
  const postings = await buildPostings({
    chunks,
    df: new Map(),
    tokenPostings: new Map(),
    docLengths: state.docLengths,
    fieldPostings: {},
    fieldDocLengths: {},
    phrasePost: new Map(),
    triPost: new Map(),
    postingsConfig: {},
    embeddingsEnabled: false,
    modelId: 'stub',
    useStubEmbeddings: true,
    log: () => {}
  });
  const timing = { start: Date.now() };
  await writeIndexArtifacts({
    outDir,
    mode: 'code',
    state,
    postings,
    postingsConfig: {},
    modelId: 'stub',
    useStubEmbeddings: true,
    dictSummary: null,
    timing,
    root: testRoot,
    userConfig: { indexing: { scm: { provider: 'none' } } },
    incrementalEnabled: false,
    fileCounts: { candidates: state.discoveredFiles.length },
    perfProfile: null,
    indexState,
    graphRelations: null,
    stageCheckpoints: null
  });
};

const readPiecesManifest = async () => {
  const manifestPath = path.join(outDir, 'pieces', 'manifest.json');
  const rawText = await fsPromises.readFile(manifestPath, 'utf8').catch(() => null);
  if (!rawText) fail(`filter-index atomic swap test failed: missing ${manifestPath}`);
  const parsed = JSON.parse(rawText);
  return parsed?.fields && typeof parsed.fields === 'object' ? parsed.fields : parsed;
};

const findFilterIndexPiece = (manifest) => {
  const pieces = Array.isArray(manifest?.pieces) ? manifest.pieces : [];
  return pieces.find((piece) => piece?.name === 'filter_index' && piece?.path) || null;
};

const readFilterIndexPayload = async (relPath) => {
  const absPath = path.join(outDir, fromPosix(relPath));
  return fsPromises.readFile(absPath, 'utf8').catch(() => null);
};

// Run 1: write a valid filter_index.
const indexState = {
  generatedAt: new Date().toISOString(),
  artifactSurfaceVersion: 'test',
  compatibilityKey: null,
  mode: 'code',
  stage: 'stage2'
};
await runWrite({ chunks: [makeChunk()], indexState });
const manifest1 = await readPiecesManifest();
const piece1 = findFilterIndexPiece(manifest1);
if (!piece1) fail('filter-index atomic swap test failed: expected filter_index piece in first manifest.');
if (!fs.existsSync(path.join(outDir, fromPosix(piece1.path)))) {
  fail(`filter-index atomic swap test failed: missing filter_index artifact at ${piece1.path}`);
}
const payload1 = await readFilterIndexPayload(piece1.path);
if (!payload1) fail('filter-index atomic swap test failed: failed to read filter_index payload (first run).');

// Run 2: force filter_index build to fail, ensure we keep previous artifact.
await runWrite({
  chunks: [makeChunk({ lang: null, metaV2: {} })],
  indexState: { ...indexState, generatedAt: new Date().toISOString() }
});
const manifest2 = await readPiecesManifest();
const piece2 = findFilterIndexPiece(manifest2);
if (!piece2) fail('filter-index atomic swap test failed: expected filter_index piece in second manifest.');
if (piece2.path !== piece1.path) {
  fail(`filter-index atomic swap test failed: expected filter_index path to be reused (${piece1.path}) but got ${piece2.path}`);
}
const payload2 = await readFilterIndexPayload(piece2.path);
if (!payload2) fail('filter-index atomic swap test failed: failed to read filter_index payload (second run).');
if (payload2 !== payload1) {
  fail('filter-index atomic swap test failed: filter_index payload changed during reuse.');
}

console.log('filter-index atomic swap test passed');

