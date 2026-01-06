#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createFileProcessor } from '../src/index/build/file-processor.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'read-failure-skip');
const repoRoot = path.join(tempRoot, 'repo');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

const targetPath = path.join(repoRoot, 'missing.js');
await fsPromises.writeFile(targetPath, 'console.log("hello");\n');
const stat = await fsPromises.stat(targetPath);
await fsPromises.unlink(targetPath);

const skippedFiles = [];
const { processFile } = createFileProcessor({
  root: repoRoot,
  mode: 'code',
  dictConfig: {},
  dictWords: new Set(),
  languageOptions: { astDataflowEnabled: false, controlFlowEnabled: false },
  postingsConfig: {},
  segmentsConfig: {},
  commentsConfig: {},
  allImports: {},
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
  skippedFiles,
  embeddingEnabled: false,
  toolInfo: null,
  tokenizationStats: null
});

const fileEntry = {
  abs: targetPath,
  rel: 'missing.js',
  stat,
  lines: 1,
  scan: { checkedBinary: true, checkedMinified: true }
};

const result = await processFile(fileEntry, 0);
if (result !== null) {
  console.error('Expected null result for read failure.');
  process.exit(1);
}
const skip = skippedFiles.find((entry) => entry?.file === targetPath && entry?.reason === 'read-failure');
if (!skip) {
  console.error('Expected read-failure skip entry.');
  process.exit(1);
}
if (!skip.code && !skip.message) {
  console.error('Expected read-failure to include error details.');
  process.exit(1);
}

console.log('read-failure skip test passed');
