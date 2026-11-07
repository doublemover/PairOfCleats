#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import { rmDirRecursive } from '../../helpers/temp.js';
import path from 'node:path';
import { createSearchLifecycle } from '../../helpers/search-lifecycle.js';

const { workspaceRoot, repoRoot, buildIndex, runSearchPayload } = await createSearchLifecycle({
  // Both queries share this invocation's generation. Prior author runs are not
  // inputs, and a timed-out prior owner must not determine this result.
  cacheScope: 'isolated',
  cacheName: 'search-determinism'
});

try {
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
  assert.ok(firstHits.length && secondHits.length, 'Expected code hits for determinism test.');
  assert.equal(JSON.stringify(firstHits), JSON.stringify(secondHits), 'Determinism test failed: search results differ between runs.');

  console.log('search determinism tests passed');
} finally {
  await rmDirRecursive(workspaceRoot);
}
