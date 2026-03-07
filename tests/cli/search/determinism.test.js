#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createSearchLifecycle } from '../../helpers/search-lifecycle.js';

const { repoRoot, buildIndex, runSearchPayload } = await createSearchLifecycle({
  cacheScope: 'shared',
  cacheName: 'search-determinism'
});

const content = 'export function alphaBetaGamma() { return "alpha beta gamma"; }\n';
const files = ['alpha-1.js'];
for (const file of files) {
  await fsPromises.writeFile(path.join(repoRoot, file), content);
}

buildIndex({
  label: 'build index',
  mode: 'code'
});

function runSearch(label) {
  return runSearchPayload('alphaBetaGamma', {
    label,
    mode: 'code',
    topN: 1,
    annEnabled: false,
    backend: 'memory'
  });
}

const first = runSearch('search first');
const second = runSearch('search second');

const firstHits = first.code || [];
const secondHits = second.code || [];
if (!firstHits.length || !secondHits.length) {
  console.error('Expected code hits for determinism test.');
  process.exit(1);
}

if (JSON.stringify(firstHits) !== JSON.stringify(secondHits)) {
  console.error('Determinism test failed: search results differ between runs.');
  process.exit(1);
}

console.log('search determinism tests passed');
