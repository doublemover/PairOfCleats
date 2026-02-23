#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createFileScanner } from '../../../src/index/build/file-scan.js';
import { createFileProcessor } from '../../../src/index/build/file-processor.js';
import { resolveBinarySkip, resolvePreReadSkip } from '../../../src/index/build/file-processor/skip.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'file-processor-skip');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const fileScanner = createFileScanner();
const runIo = (fn) => fn();

const minifiedPath = path.join(tempRoot, 'app.min.js');
await fs.writeFile(minifiedPath, 'const x=1;');
const minifiedStat = await fs.stat(minifiedPath);
const minifiedSkip = await resolvePreReadSkip({
  abs: minifiedPath,
  fileEntry: { lines: 1, scan: { checkedBinary: true, checkedMinified: true } },
  fileStat: minifiedStat,
  ext: '.js',
  fileCaps: {},
  fileScanner,
  runIo
});
if (!minifiedSkip || minifiedSkip.reason !== 'minified') {
  fail('Expected minified filename to skip with reason=minified.');
}

const extractedDocPath = path.join(tempRoot, 'report.min.pdf');
await fs.writeFile(extractedDocPath, Buffer.from('%PDF-1.4\n%test\n'));
const extractedDocStat = await fs.stat(extractedDocPath);
const extractedDocSkip = await resolvePreReadSkip({
  abs: extractedDocPath,
  fileEntry: {
    lines: 1,
    scan: {
      checkedBinary: true,
      checkedMinified: true,
      skip: { reason: 'binary', method: 'file-type' }
    }
  },
  fileStat: extractedDocStat,
  ext: '.pdf',
  fileCaps: {},
  fileScanner,
  runIo,
  bypassBinaryMinifiedSkip: true
});
if (extractedDocSkip) {
  fail('Expected document extraction path to bypass binary/minified pre-read skips.');
}

const cappedPath = path.join(tempRoot, 'big.txt');
await fs.writeFile(cappedPath, 'abcdef');
const cappedStat = await fs.stat(cappedPath);
const cappedSkip = await resolvePreReadSkip({
  abs: cappedPath,
  fileEntry: { lines: 1, scan: { checkedBinary: true, checkedMinified: true } },
  fileStat: cappedStat,
  ext: '.txt',
  fileCaps: { default: { maxBytes: 1 } },
  fileScanner,
  runIo
});
if (!cappedSkip || cappedSkip.reason !== 'oversize' || cappedSkip.maxBytes !== 1) {
  fail('Expected maxBytes to skip with reason=oversize and maxBytes.');
}

const firstPartyDocsetPath = path.join(tempRoot, 'src', 'docset', 'guide.md');
await fs.mkdir(path.dirname(firstPartyDocsetPath), { recursive: true });
await fs.writeFile(firstPartyDocsetPath, '# guide', 'utf8');
const firstPartyDocsetStat = await fs.stat(firstPartyDocsetPath);
const firstPartyDocsetSkip = await resolvePreReadSkip({
  abs: firstPartyDocsetPath,
  fileEntry: { lines: 1, scan: { checkedBinary: true, checkedMinified: true } },
  fileStat: firstPartyDocsetStat,
  ext: '.md',
  fileCaps: {},
  fileScanner,
  runIo
});
if (firstPartyDocsetSkip) {
  fail('Expected first-party src/docset path not to be skipped as generated docset.');
}

const generatedDocsetPath = path.join(
  tempRoot,
  'build',
  'API.docset',
  'Contents',
  'Resources',
  'Documents',
  'index.html'
);
await fs.mkdir(path.dirname(generatedDocsetPath), { recursive: true });
await fs.writeFile(generatedDocsetPath, '<html></html>', 'utf8');
const generatedDocsetStat = await fs.stat(generatedDocsetPath);
const generatedDocsetSkip = await resolvePreReadSkip({
  abs: generatedDocsetPath,
  fileEntry: { lines: 1, scan: { checkedBinary: true, checkedMinified: true } },
  fileStat: generatedDocsetStat,
  ext: '.html',
  fileCaps: {},
  fileScanner,
  runIo
});
if (!generatedDocsetSkip || generatedDocsetSkip.reason !== 'generated-docset') {
  fail('Expected generated docset bundle payload path to skip with reason=generated-docset.');
}

const binarySkip = await resolveBinarySkip({
  abs: minifiedPath,
  fileBuffer: Buffer.from([0, 0, 0, 0, 0]),
  fileScanner
});
if (!binarySkip || binarySkip.reason !== 'binary') {
  fail('Expected binary buffer to skip with reason=binary.');
}

const skippedFiles = [];
const { processFile } = createFileProcessor({
  root,
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

const unreadableDir = path.join(tempRoot, 'unreadable');
await fs.mkdir(unreadableDir, { recursive: true });
const unreadableStat = await fs.stat(unreadableDir);
const unreadableEntry = {
  abs: unreadableDir,
  rel: 'unreadable',
  stat: unreadableStat,
  lines: 1,
  scan: { checkedBinary: true, checkedMinified: true }
};
const unreadableResult = await processFile(unreadableEntry, 0);
if (unreadableResult !== null) {
  fail('Expected unreadable path to return null.');
}
const unreadableSkip = skippedFiles.find((entry) => entry?.file === unreadableDir && entry?.reason === 'unreadable');
if (!unreadableSkip) {
  fail('Expected unreadable path to be recorded as skipped.');
}

console.log('file processor skip tests passed');

