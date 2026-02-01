#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { expandContext } from '../../../src/retrieval/context-expansion.js';

const fixtureRoot = path.join(
  process.cwd(),
  'tests',
  'fixtures',
  'retrieval',
  'context-expansion'
);

const chunkMeta = JSON.parse(
  fs.readFileSync(path.join(fixtureRoot, 'chunk-meta-shuffled.json'), 'utf8')
);
const graphRelations = JSON.parse(
  fs.readFileSync(path.join(fixtureRoot, 'graph-relations-basic.json'), 'utf8')
);

const result = expandContext({
  hits: [{ id: 7 }],
  chunkMeta,
  graphRelations,
  options: {
    maxPerHit: 5,
    maxTotal: 5,
    includeCalls: true
  }
});

const ids = new Set(result.contextHits.map((hit) => hit.id));
if (!ids.has(42)) {
  console.error('Expected context expansion to resolve docId via chunkUid map.');
  process.exit(1);
}

console.log('context expansion shuffled chunk meta test passed');
