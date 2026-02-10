#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildFileMeta } from '../../../src/index/build/artifacts/file-meta.js';

const fileCount = 2500;
const fileInfoByPath = new Map();
for (let i = 0; i < fileCount; i += 1) {
  fileInfoByPath.set(`src/file-${i}.js`, {
    size: i + 1,
    hash: `hash-${i}`,
    hashAlgo: 'sha1'
  });
}

const state = {
  chunks: [],
  fileInfoByPath
};

const originalIncludes = Array.prototype.includes;
let includesCalls = 0;
Array.prototype.includes = function includesPatched(...args) {
  includesCalls += 1;
  return originalIncludes.apply(this, args);
};

try {
  const result = buildFileMeta(state);
  assert.equal(result.fileMeta.length, fileCount, 'expected all fileInfo paths to be materialized');
  assert.equal(includesCalls, 0, 'expected no O(n^2) includes membership checks');
} finally {
  Array.prototype.includes = originalIncludes;
}

console.log('file meta membership performance test passed');
