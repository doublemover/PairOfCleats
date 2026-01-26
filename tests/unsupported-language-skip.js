#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createFileProcessor } from '../src/index/build/file-processor.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'unsupported-language-skip');
const repoRoot = path.join(tempRoot, 'repo');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

const targetPath = path.join(repoRoot, 'unknown.foo');
await fsPromises.writeFile(targetPath, 'just some text\n');
const stat = await fsPromises.stat(targetPath);

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
  rel: 'unknown.foo',
  stat,
  lines: 1,
  scan: { checkedBinary: true, checkedMinified: true }
};

const result = await processFile(fileEntry, 0);
if (result !== null) {
  console.error('Expected null result for unsupported language.');
  process.exit(1);
}
const skip = skippedFiles.find((entry) => entry?.file === targetPath && entry?.reason === 'unsupported-language');
if (!skip) {
  console.error('Expected unsupported-language skip entry.');
  process.exit(1);
}

console.log('unsupported-language skip test passed');

