#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { rankMinhash } from '../../../src/retrieval/rankers.js';

const { fixtureRoot, codeDir, proseDir } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'fixture-sample',
  cacheScope: 'shared'
});

const assertMinhashConsistency = (label, chunkMetaPath, minhashPath) => {
  const rawChunks = fs.readFileSync(chunkMetaPath, 'utf8');
  const rawSigs = fs.readFileSync(minhashPath, 'utf8');
  const chunks = JSON.parse(rawChunks);
  const sigPayload = JSON.parse(rawSigs);
  const signatures = sigPayload?.signatures;
  if (!Array.isArray(chunks) || !Array.isArray(signatures)) {
    console.error(`Invalid minhash data for ${label}: ${minhashPath}`);
    process.exit(1);
  }
  const idx = chunks.findIndex((chunk, i) => Array.isArray(chunk?.tokens) && chunk.tokens.length && Array.isArray(signatures[i]));
  if (idx < 0) {
    console.error(`No usable minhash chunk found for ${label}: ${minhashPath}`);
    process.exit(1);
  }
  const tokens = chunks[idx].tokens;
  const scored = rankMinhash({ minhash: { signatures } }, tokens, 1);
  if (!scored.length || scored[0].idx !== idx || scored[0].sim !== 1) {
    console.error(`Minhash mismatch for ${label}: ${minhashPath}`);
    process.exit(1);
  }
};

assertMinhashConsistency('code', path.join(codeDir, 'chunk_meta.json'), path.join(codeDir, 'minhash_signatures.json'));
assertMinhashConsistency('prose', path.join(proseDir, 'chunk_meta.json'), path.join(proseDir, 'minhash_signatures.json'));

console.log('Fixture minhash consistency ok.');
