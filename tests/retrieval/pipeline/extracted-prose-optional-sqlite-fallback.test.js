#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import {
  createOptionalExtractedProseRoot,
  loadOptionalExtractedProseIndexes,
  writeOptionalExtractedProseIndexPair
} from './helpers/optional-extracted-prose-index-fixture.js';

applyTestEnv();

const rootDir = await createOptionalExtractedProseRoot('poc-extracted-sqlite-fallback-');
const compatibilityKey = 'compat-extracted-sqlite-fallback';
await writeOptionalExtractedProseIndexPair(rootDir, {
  codeCompatibilityKey: compatibilityKey,
  codeChunkMeta: [{ id: 11, file: 'src/code.js', start: 0, end: 4 }],
  extractedProseChunkMeta: [{ id: 22, file: 'docs/notes.md', start: 0, end: 4 }]
});

const sqliteCalls = [];
/**
 * SQLite loader stub: returns synthetic code rows and intentionally fails for
 * extracted-prose to exercise optional artifact fallback behavior.
 *
 * @param {string} mode
 * @param {object} options
 * @returns {{chunkMeta:object[]}}
 */
const loadIndexFromSqlite = (mode, options) => {
  sqliteCalls.push({
    mode,
    options: {
      includeDense: options?.includeDense,
      includeMinhash: options?.includeMinhash,
      includeChunks: options?.includeChunks,
      includeFilterIndex: options?.includeFilterIndex
    }
  });
  if (mode === 'code') {
    return {
      chunkMeta: [{ id: 701, file: 'src/sqlite-only.js', start: 0, end: 1 }]
    };
  }
  if (mode === 'extracted-prose') {
    throw new Error('sqlite extracted-prose index unavailable');
  }
  throw new Error(`unexpected sqlite mode ${mode}`);
};

const loaded = await loadOptionalExtractedProseIndexes(rootDir, {
  useSqlite: true,
  sqliteFtsRequested: true,
  lancedbConfig: { enabled: false },
  requiredArtifacts: new Set(),
  loadIndexFromSqlite,
  loadIndexFromLmdb: () => {
    throw new Error('unexpected lmdb load');
  },
  resolvedDenseVectorMode: 'auto'
});

const sqliteModes = new Set(sqliteCalls.map((entry) => entry.mode));
assert.equal(sqliteModes.has('code'), true, 'expected sqlite loader call for code mode');
assert.equal(sqliteModes.has('extracted-prose'), true, 'expected sqlite loader call for extracted-prose mode');

for (const mode of ['code', 'extracted-prose']) {
  const call = sqliteCalls.find((entry) => entry.mode === mode);
  assert.equal(call?.options?.includeDense, false, `expected includeDense=false for mode ${mode}`);
  assert.equal(call?.options?.includeMinhash, false, `expected includeMinhash=false for mode ${mode}`);
  assert.equal(call?.options?.includeChunks, false, `expected sqlite lazy chunk include=false for mode ${mode}`);
  assert.equal(call?.options?.includeFilterIndex, false, `expected includeFilterIndex=false for mode ${mode}`);
}

assert.equal(loaded.runExtractedProse, false, 'expected optional extracted-prose run flag to remain disabled');
assert.equal(loaded.extractedProseLoaded, true, 'expected extracted-prose mode to stay loaded via fallback');
assert.equal(
  loaded.idxCode?.chunkMeta?.[0]?.id,
  701,
  'expected code mode to use sqlite loader payload'
);
assert.equal(
  loaded.idxExtractedProse?.chunkMeta?.[0]?.id,
  22,
  'expected extracted-prose mode to fall back to artifact loader payload'
);

console.log('optional extracted-prose sqlite fallback test passed');
