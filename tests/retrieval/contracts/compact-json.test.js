#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';

const { root, fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'fixture-sample'
});

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'search.js'),
    'message',
    '--json',
    '--backend',
    'memory',
    '--no-ann',
    '--repo',
    fixtureRoot
  ],
  { cwd: fixtureRoot, env, encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error('Fixture compact JSON failed: search error.');
  process.exit(result.status ?? 1);
}

const payload = JSON.parse(result.stdout || '{}');
const compactHits = [...(payload.code || []), ...(payload.prose || [])];
if (!compactHits.length) {
  console.error('Fixture compact JSON returned no results.');
  process.exit(1);
}
const compactSample = compactHits[0] || {};
if (!compactSample.file && compactSample.id === undefined) {
  console.error('Fixture compact JSON missing hit identity fields.');
  process.exit(1);
}
if (!Number.isFinite(compactSample.score) || !compactSample.scoreType) {
  console.error('Fixture compact JSON missing score or scoreType.');
  process.exit(1);
}

const forbiddenFields = [
  'tokens',
  'ngrams',
  'preContext',
  'postContext',
  'codeRelations',
  'docmeta',
  'stats',
  'complexity',
  'lint',
  'externalDocs',
  'chunk_authors',
  'scoreBreakdown'
];
for (const field of forbiddenFields) {
  if (compactSample[field] !== undefined) {
    console.error(`Fixture compact JSON includes unexpected field: ${field}`);
    process.exit(1);
  }
}

console.log('Retrieval compact JSON contract ok.');
