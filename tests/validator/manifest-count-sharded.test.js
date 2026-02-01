#!/usr/bin/env node
import assert from 'node:assert/strict';
import { sumManifestCounts } from '../../src/index/validate/manifest.js';

const manifest = {
  pieces: [
    { name: 'symbols', path: 'symbols.part-00000.jsonl', count: 2 },
    { name: 'symbols', path: 'symbols.part-00001.jsonl', count: 3 },
    { name: 'symbols_meta', path: 'symbols.meta.json' },
    { name: 'chunk_meta', path: 'chunk_meta.json', count: 7 }
  ]
};

assert.equal(sumManifestCounts(manifest, 'symbols'), 5, 'should sum counts across shards');
assert.equal(sumManifestCounts(manifest, 'chunk_meta'), 7, 'single entry should report its count');
assert.equal(sumManifestCounts(manifest, 'missing'), null, 'missing name should return null');

console.log('manifest count aggregation test passed');
