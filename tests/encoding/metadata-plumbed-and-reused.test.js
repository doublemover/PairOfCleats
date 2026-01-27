#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { reuseCachedBundle } from '../../src/index/build/file-processor/cached-bundle.js';
import { buildFileMeta } from '../../src/index/build/artifacts/file-meta.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'encoding-meta');
const repoRoot = path.join(tempRoot, 'repo');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });

const targetPath = path.join(repoRoot, 'encoded.txt');
await fs.writeFile(targetPath, 'demo');
const stat = await fs.stat(targetPath);

const cachedBundle = {
  chunks: [
    {
      file: 'encoded.txt',
      ext: '.txt',
      start: 0,
      end: 4,
      startLine: 1,
      endLine: 1,
      kind: 'text',
      tokens: ['demo'],
      chunkUid: 'ck:encoded',
      virtualPath: 'encoded.txt'
    }
  ],
  fileRelations: {},
  encoding: 'windows-1252',
  encodingFallback: true,
  encodingConfidence: 0.42
};

const { result, skip } = reuseCachedBundle({
  abs: targetPath,
  relKey: 'encoded.txt',
  fileIndex: 0,
  fileStat: stat,
  fileHash: 'hash',
  fileHashAlgo: 'sha1',
  ext: '.txt',
  fileCaps: {},
  cachedBundle,
  incrementalState: {
    manifest: {
      files: {
        'encoded.txt': {
          bundle: 'encoded.json',
          hash: 'hash',
          encoding: 'windows-1252',
          encodingFallback: true,
          encodingConfidence: 0.42
        }
      }
    }
  },
  fileStructural: null,
  toolInfo: null,
  fileStart: Date.now(),
  knownLines: 1,
  fileLanguageId: null
});

assert.equal(skip, null);
assert(result, 'expected cached bundle reuse result');
assert.equal(result.fileInfo.encoding, 'windows-1252');
assert.equal(result.fileInfo.encodingFallback, true);
assert.equal(result.fileInfo.encodingConfidence, 0.42);

const { fileMeta } = buildFileMeta({
  chunks: result.chunks,
  fileInfoByPath: new Map([[result.relKey, result.fileInfo]])
});
const entry = fileMeta.find((item) => item.file === 'encoded.txt');
assert(entry, 'expected file meta entry');
assert.equal(entry.encoding, 'windows-1252');
assert.equal(entry.encodingFallback, true);
assert.equal(entry.encodingConfidence, 0.42);

console.log('encoding metadata plumbed and reused ok');

