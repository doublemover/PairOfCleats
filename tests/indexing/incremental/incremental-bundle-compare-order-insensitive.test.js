#!/usr/bin/env node
import assert from 'node:assert/strict';
import { shouldReuseExistingBundle } from '../../../src/index/build/incremental/bundle-compare.js';

const existingBundle = {
  hash: 'hash:a',
  mtimeMs: 1700000000000,
  size: 128,
  chunks: [
    {
      file: 'src/a.js',
      chunkId: 'a:1',
      text: 'seed text'
    }
  ],
  fileRelations: {
    imports: [
      {
        source: './dep.js',
        kind: 'value'
      }
    ],
    stats: {
      count: 1,
      depth: 0
    }
  },
  vfsManifestRows: [
    {
      languageId: 'javascript',
      virtualPath: '/vfs/src/a.js',
      meta: {
        owner: 'repo',
        lane: 'code'
      }
    }
  ],
  encoding: null,
  encodingFallback: null,
  encodingConfidence: null
};

const nextBundleWithReorderedKeys = {
  hash: 'hash:a',
  mtimeMs: 1700000000000,
  size: 128,
  chunks: [
    {
      chunkId: 'a:1',
      text: 'seed text',
      file: 'src/a.js'
    }
  ],
  fileRelations: {
    stats: {
      depth: 0,
      count: 1
    },
    imports: [
      {
        kind: 'value',
        source: './dep.js'
      }
    ]
  },
  vfsManifestRows: [
    {
      virtualPath: '/vfs/src/a.js',
      languageId: 'javascript',
      meta: {
        lane: 'code',
        owner: 'repo'
      }
    }
  ],
  encoding: null,
  encodingFallback: null,
  encodingConfidence: null
};

assert.equal(
  shouldReuseExistingBundle(existingBundle, nextBundleWithReorderedKeys),
  true,
  'expected bundle reuse check to ignore object key ordering differences'
);

console.log('incremental bundle compare order-insensitive test passed');
