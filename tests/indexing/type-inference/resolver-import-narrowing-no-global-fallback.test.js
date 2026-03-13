#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildSymbolIndex, resolveSymbolRef } from '../../../src/index/type-inference-crossfile/resolver.js';

const entries = [{
  file: 'src/unrelated.js',
  name: 'Thing',
  qualifiedName: 'Thing',
  kind: 'class',
  chunkUid: 'chunk-unrelated',
  symbol: {
    symbolId: 'sym-unrelated',
    chunkUid: 'chunk-unrelated',
    symbolKey: 'Thing',
    signatureKey: 'Thing()',
    kindGroup: 'type'
  }
}];

const symbolIndex = buildSymbolIndex(entries);
const fileRelations = {
  'src/main.js': {
    importBindings: {
      Thing: {
        module: './dep.js',
        imported: 'Thing'
      }
    }
  }
};

const resolved = resolveSymbolRef({
  targetName: 'Thing',
  fromFile: 'src/main.js',
  fileRelations,
  symbolIndex,
  fileSet: new Set(['src/main.js', 'src/dep.js', 'src/unrelated.js'])
});

assert.equal(resolved.status, 'unresolved', 'expected unresolved when narrowed import file has no matching symbols');
assert.equal(
  resolved.importHint?.resolvedFile,
  'src/dep.js',
  'expected import hint to preserve resolved import target'
);
assert.equal(resolved.candidates.length, 0, 'expected no fallback candidates from unrelated global symbols');

console.log('resolver import narrowing no-global-fallback test passed');
