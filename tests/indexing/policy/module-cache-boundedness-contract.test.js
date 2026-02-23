#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { repoRoot } from '../../helpers/root.js';

applyTestEnv();

const root = repoRoot();

const contracts = [
  {
    file: 'src/graph/store.js',
    patterns: [
      /GRAPH_INDEX_CACHE_MAX/,
      /GRAPH_ARTIFACT_CACHE_MAX/,
      /while\s*\(graphIndexCache\.size\s*>\s*GRAPH_INDEX_CACHE_MAX\)/,
      /while\s*\(graphArtifactCache\.size\s*>\s*GRAPH_ARTIFACT_CACHE_MAX\)/,
      /peakSize/
    ]
  },
  {
    file: 'src/retrieval/index-cache.js',
    patterns: [
      /INDEX_SIGNATURE_CACHE_MAX_ENTRIES/,
      /pruneIndexSignatureCache/,
      /overflow\s*=\s*indexSignatureCache\.size\s*-\s*INDEX_SIGNATURE_CACHE_MAX_ENTRIES/
    ]
  },
  {
    file: 'src/graph/neighborhood.js',
    patterns: [
      /TRAVERSAL_CACHE_MAX/,
      /setCachedValue\(traversalCache,\s*cacheKeyInfo\.key,\s*output,\s*TRAVERSAL_CACHE_MAX\)/
    ]
  },
  {
    file: 'src/index/build/build-state/store.js',
    patterns: [
      /STATE_MAP_MAX_ENTRIES/,
      /trimStateMap\(stateCaches,\s*\{\s*skipActive:\s*true\s*\}\)/,
      /trimStateMap\(stateErrors,\s*\{\s*skipActive:\s*true\s*\}\)/
    ]
  }
];

for (const contract of contracts) {
  const fullPath = path.join(root, contract.file);
  const text = fs.readFileSync(fullPath, 'utf8');
  for (const pattern of contract.patterns) {
    assert.match(text, pattern, `${contract.file} missing boundedness contract: ${pattern}`);
  }
}

console.log('module cache boundedness contract test passed');
