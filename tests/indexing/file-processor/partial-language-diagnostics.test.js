#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createFileProcessor } from '../../../src/index/build/file-processor.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'partial-language-diagnostics');
const repoRoot = path.join(tempRoot, 'repo');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

const targetPath = path.join(repoRoot, 'build.cmake');
const source = [
  'include("${CMAKE_CURRENT_SOURCE_DIR}/deps.cmake")',
  'add_subdirectory(src)'
].join('\n');
await fsPromises.writeFile(targetPath, source);
const stat = await fsPromises.stat(targetPath);

const { processFile } = createFileProcessor({
  root: repoRoot,
  mode: 'code',
  dictConfig: {},
  dictWords: new Set(),
  languageOptions: {
    skipUnknownLanguages: true,
    astDataflowEnabled: false,
    controlFlowEnabled: false,
    treeSitter: { enabled: false }
  },
  postingsConfig: {},
  segmentsConfig: {},
  commentsConfig: {},
  contextWin: 0,
  incrementalState: {
    enabled: false,
    manifest: { files: {} },
    bundleDir: '',
    bundleFormat: 'json'
  },
  getChunkEmbedding: async () => null,
  getChunkEmbeddings: async () => null,
  typeInferenceEnabled: false,
  riskAnalysisEnabled: false,
  riskConfig: {},
  relationsEnabled: false,
  seenFiles: new Set(),
  gitBlameEnabled: false,
  lintEnabled: false,
  complexityEnabled: false,
  structuralMatches: null,
  cacheConfig: {},
  cacheReporter: null,
  queues: null,
  workerPool: null,
  crashLogger: null,
  skippedFiles: [],
  embeddingEnabled: false,
  toolInfo: null,
  tokenizationStats: null
});

const fileEntry = {
  abs: targetPath,
  rel: 'build.cmake',
  stat,
  lines: source.split('\n').length,
  scan: { checkedBinary: true, checkedMinified: true }
};

const result = await processFile(fileEntry, 0);
if (!result?.chunks?.length) {
  fail('Expected cmake file to produce chunks.');
}

const firstChunk = result.chunks[0];
const usrCapabilities = firstChunk?.docmeta?.usrCapabilities;
if (!usrCapabilities || usrCapabilities.state !== 'partial' || usrCapabilities.source !== 'cmake') {
  fail('Expected partial usrCapabilities envelope for cmake chunk.');
}

const diagnostics = Array.isArray(usrCapabilities.diagnostics) ? usrCapabilities.diagnostics : [];
const downgrade = diagnostics.find((entry) =>
  entry?.code === 'USR-W-CAPABILITY-DOWNGRADED' && entry?.reasonCode === 'USR-R-HEURISTIC-ONLY');
if (!downgrade) {
  fail('Expected downgrade diagnostic for import-collector adapter path.');
}

console.log('partial language diagnostics test passed');
