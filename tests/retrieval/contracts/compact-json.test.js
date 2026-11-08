#!/usr/bin/env node
import path from 'node:path';
import assert from 'node:assert/strict';
import { compactHit } from '../../../src/retrieval/cli/render-output.js';
import { buildRetrievalHitKey } from '../../../src/retrieval/hit-comparison.js';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { runNode } from '../../helpers/run-node.js';

const stableUid = 'ck64:v1:compact-fixture:0000000000000001';
const artifactHit = { id: 0, file: 'source.js', chunkUid: stableUid };
const sqliteHit = { id: 17, file: 'source.js', metaV2: { chunkUid: stableUid } };
assert.equal(compactHit(sqliteHit).chunkUid, stableUid);
assert.equal(buildRetrievalHitKey(compactHit(artifactHit)), buildRetrievalHitKey(compactHit(sqliteHit)),
  'compact representation preserves cross-backend identity independently of local ordinals');
assert.equal(compactHit({ ...sqliteHit, chunkUid: 'authoritative-top-level' }).chunkUid, 'authoritative-top-level');
assert.equal(compactHit({ id: 0 }).chunkUid, undefined, 'a local ordinal cannot invent stable identity');
assert.equal(compactHit(sqliteHit).metaV2, undefined, 'compact metadata remains bounded to the public projection');

const { root, fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'fixture-sample',
  cacheScope: 'shared'
});

const result = runNode(
  [
    path.join(root, 'search.js'),
    'message',
    '--json',
    '--compact',
    '--backend',
    'memory',
    '--no-ann',
    '--repo',
    fixtureRoot
  ],
  'Fixture compact JSON failed: search error.',
  fixtureRoot,
  env,
  { stdio: 'pipe' }
);

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
