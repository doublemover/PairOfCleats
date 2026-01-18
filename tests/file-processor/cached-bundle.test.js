#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { reuseCachedBundle } from '../../src/index/build/file-processor/cached-bundle.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'file-processor-cached');
const repoRoot = path.join(tempRoot, 'repo');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });

const targetPath = path.join(repoRoot, 'cached.js');
await fs.writeFile(targetPath, 'export const demo = 1;\n');
const stat = await fs.stat(targetPath);

const cachedBundle = {
  chunks: [
    {
      file: 'cached.js',
      ext: '.js',
      start: 0,
      end: 10,
      startLine: 1,
      endLine: 1,
      kind: 'code',
      name: 'demo',
      lang: 'javascript',
      codeRelations: {
        imports: ['dep'],
        exports: ['demo'],
        calls: [['demo', 'dep']]
      },
      docmeta: { signature: 'demo()' },
      tokens: ['demo'],
      seq: ['demo'],
      ngrams: [],
      chargrams: []
    }
  ],
  fileRelations: null
};

const { result, skip } = reuseCachedBundle({
  abs: targetPath,
  relKey: 'cached.js',
  fileIndex: 0,
  fileStat: stat,
  fileHash: 'hash',
  fileHashAlgo: 'sha1',
  ext: '.js',
  fileCaps: {},
  cachedBundle,
  incrementalState: {
    manifest: {
      files: {
        'cached.js': { bundle: 'cached.json', hash: 'hash' }
      }
    }
  },
  allImports: {
    dep: ['dep.js']
  },
  fileStructural: null,
  toolInfo: null,
  fileStart: Date.now(),
  knownLines: 1,
  fileLanguageId: null
});

if (skip) {
  fail('Expected cached bundle to be reused without skip.');
}
if (!result) {
  fail('Expected cached bundle reuse result.');
}
const importLinks = Array.isArray(result.fileRelations?.importLinks)
  ? result.fileRelations.importLinks
  : [];
if (importLinks.length !== 1 || importLinks[0] !== 'dep.js') {
  fail('Expected importLinks to be rehydrated from allImports with stable targets.');
}
const chunk = result.chunks[0];
if (!chunk?.metaV2?.chunkId) {
  fail('Expected cached chunk to have metaV2 chunkId.');
}
if (chunk?.metaV2?.fileHash !== 'hash' || chunk?.metaV2?.fileHashAlgo !== 'sha1') {
  fail('Expected cached chunk to include file hash metadata.');
}
if (!Array.isArray(chunk?.codeRelations?.calls)) {
  fail('Expected cached chunk to preserve non-file relation fields.');
}
if (!result.fileMetrics?.cached) {
  fail('Expected cached file metrics to set cached=true.');
}

console.log('file processor cached bundle tests passed');
