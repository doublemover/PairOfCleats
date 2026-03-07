import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { rmDirRecursive } from '../../helpers/temp.js';
import { writeBundleFile } from '../../../src/shared/bundle-io.js';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';

applyTestEnv();

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.error('better-sqlite3 is required for sqlite bundle vocab cache eviction tests.');
  process.exit(1);
}

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-bundle-vocab-cache-eviction');
const bundleDir = path.join(tempRoot, 'bundles');
const dbPath = path.join(tempRoot, 'index-code.db');

await rmDirRecursive(tempRoot);
await fs.mkdir(bundleDir, { recursive: true });

const writeFixtureBundle = async (bundleName, file, token, ngram, gram) => {
  await writeBundleFile({
    bundlePath: path.join(bundleDir, bundleName),
    format: 'json',
    bundle: {
      file,
      chunks: [{
        file,
        start: 0,
        end: 1,
        ext: '.js',
        tokens: [token],
        ngrams: [ngram],
        chargrams: [gram]
      }]
    }
  });
};

await writeFixtureBundle('bundle-a.json', 'a.js', 'alpha', 'shared phrase', 'shared-gram');
await writeFixtureBundle('bundle-b.json', 'b.js', 'beta', 'other phrase', 'other-gram');
await writeFixtureBundle('bundle-c.json', 'c.js', 'alpha', 'shared phrase', 'shared-gram');

const result = await buildDatabaseFromBundles({
  Database,
  outPath: dbPath,
  mode: 'code',
  incrementalData: {
    bundleDir,
    manifest: {
      files: {
        'a.js': { bundles: ['bundle-a.json'], mtimeMs: 1, size: 1, hash: 'a' },
        'b.js': { bundles: ['bundle-b.json'], mtimeMs: 2, size: 1, hash: 'b' },
        'c.js': { bundles: ['bundle-c.json'], mtimeMs: 3, size: 1, hash: 'c' }
      }
    }
  },
  envConfig: { bundleThreads: 1 },
  threadLimits: { fileConcurrency: 1 },
  emitOutput: false,
  validateMode: 'off',
  vectorConfig: { enabled: false },
  modelConfig: { id: null },
  workerPath: null,
  vocabLookupCacheMaxEntries: 1
});

assert.equal(result.reason || null, null, `expected bundle build success, got ${result.reason || 'none'}`);
assert.equal(result.count, 3, `expected 3 indexed chunks, got ${result.count}`);

const db = new Database(dbPath, { readonly: true });
try {
  const tokenRows = db.prepare('SELECT token_id, token FROM token_vocab WHERE mode = ? ORDER BY token_id').all('code');
  const phraseRows = db.prepare('SELECT phrase_id, ngram FROM phrase_vocab WHERE mode = ? ORDER BY phrase_id').all('code');
  const gramRows = db.prepare('SELECT gram_id, gram FROM chargram_vocab WHERE mode = ? ORDER BY gram_id').all('code');
  const alphaTokenId = db.prepare('SELECT token_id AS id FROM token_vocab WHERE mode = ? AND token = ?').get('code', 'alpha')?.id;
  const sharedPhraseId = db.prepare('SELECT phrase_id AS id FROM phrase_vocab WHERE mode = ? AND ngram = ?').get('code', 'shared phrase')?.id;
  const sharedGramId = db.prepare('SELECT gram_id AS id FROM chargram_vocab WHERE mode = ? AND gram = ?').get('code', 'shared-gram')?.id;
  const alphaPostings = db.prepare('SELECT COUNT(*) AS total FROM token_postings WHERE mode = ? AND token_id = ?').get('code', alphaTokenId)?.total;
  const sharedPhrasePostings = db.prepare('SELECT COUNT(*) AS total FROM phrase_postings WHERE mode = ? AND phrase_id = ?').get('code', sharedPhraseId)?.total;
  const sharedGramPostings = db.prepare('SELECT COUNT(*) AS total FROM chargram_postings WHERE mode = ? AND gram_id = ?').get('code', sharedGramId)?.total;

  assert.deepEqual(
    tokenRows.map((row) => row.token),
    ['alpha', 'beta'],
    `expected stable token vocab rows, got ${JSON.stringify(tokenRows)}`
  );
  assert.deepEqual(
    phraseRows.map((row) => row.ngram),
    ['shared phrase', 'other phrase'],
    `expected stable phrase vocab rows, got ${JSON.stringify(phraseRows)}`
  );
  assert.deepEqual(
    gramRows.map((row) => row.gram),
    ['shared-gram', 'other-gram'],
    `expected stable chargram vocab rows, got ${JSON.stringify(gramRows)}`
  );
  assert.equal(alphaPostings, 2, `expected alpha token id reuse across 2 docs, got ${alphaPostings}`);
  assert.equal(sharedPhrasePostings, 2, `expected shared phrase id reuse across 2 docs, got ${sharedPhrasePostings}`);
  assert.equal(sharedGramPostings, 2, `expected shared gram id reuse across 2 docs, got ${sharedGramPostings}`);
} finally {
  db.close();
  await rmDirRecursive(tempRoot);
}

console.log('sqlite bundle vocab cache eviction test passed');
