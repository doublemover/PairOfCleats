#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createSearchLifecycle } from '../../helpers/search-lifecycle.js';

const { repoRoot, runSearchPayload, buildIndex } = await createSearchLifecycle({
  cacheScope: 'shared',
  cacheName: 'search-contract'
});

await fsPromises.writeFile(
  path.join(repoRoot, 'README.md'),
  '# Sample\n\nalpha bravo\n'
);

buildIndex({
  label: 'build index for search contract',
  mode: 'prose'
});

const payload = runSearchPayload('alpha', {
  label: 'search contract run',
  mode: 'prose',
  stats: true,
  backend: 'memory',
  annEnabled: false
});

if (!payload || typeof payload !== 'object') {
  console.error('Failed: search contract payload missing');
  process.exit(1);
}

for (const key of ['backend', 'code', 'prose', 'extractedProse', 'records', 'stats']) {
  if (!(key in payload)) {
    console.error(`Failed: search contract missing ${key}`);
    process.exit(1);
  }
}

if (!Array.isArray(payload.prose) || payload.prose.length === 0) {
  console.error('Failed: search contract expected prose hits');
  process.exit(1);
}

const hit = payload.prose[0];
if (!hit || !hit.file) {
  console.error('Failed: search contract hit missing file');
  process.exit(1);
}
if (!Number.isFinite(hit.startLine)) {
  console.error('Failed: search contract hit missing startLine');
  process.exit(1);
}

if (!payload.stats?.models || !Object.prototype.hasOwnProperty.call(payload.stats.models, 'extractedProse')) {
  console.error('Failed: search contract missing extracted-prose model field');
  process.exit(1);
}

console.log('search contract tests passed');

