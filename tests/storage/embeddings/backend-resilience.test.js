#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { requireOrSkip } from '../../helpers/require-or-skip.js';
import { updateSqliteDense } from '../../../tools/build/embeddings/sqlite-dense.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

requireOrSkip({ capability: 'sqlite', reason: 'Skipping embeddings backend resilience test; sqlite unavailable.' });

const { default: Database } = await import('better-sqlite3');

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'embeddings-backend-resilience');
const dbPath = path.join(tempRoot, 'shared-index.db');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const db = new Database(dbPath);
db.exec('CREATE TABLE dense_vectors (mode TEXT, doc_id INTEGER, vector BLOB)');
db.exec('CREATE TABLE dense_meta (mode TEXT, dims INTEGER, scale REAL, model TEXT, min_val REAL, max_val REAL, levels INTEGER)');
db.close();

const userConfig = {
  sqlite: {
    vectorExtension: {
      enabled: false,
      table: 'dense_vectors_ann',
      column: 'embedding'
    }
  }
};

const baseArgs = {
  Database,
  root: tempRoot,
  userConfig,
  indexRoot: tempRoot,
  dbPath,
  dims: 2,
  scale: 0.1,
  modelId: 'stub',
  quantization: { minVal: -1, maxVal: 1, levels: 256 },
  emitOutput: false,
  warnOnMissing: false,
  sharedDb: true
};

const codeResult = updateSqliteDense({
  ...baseArgs,
  mode: 'code',
  vectors: [[1, 2]]
});
const proseResult = updateSqliteDense({
  ...baseArgs,
  mode: 'prose',
  vectors: [[3, 4]]
});

if (codeResult?.vectorAnn?.table !== 'dense_vectors_ann_code') {
  console.error(`Expected code ANN table to be dense_vectors_ann_code, got ${codeResult?.vectorAnn?.table}`);
  process.exit(1);
}
if (proseResult?.vectorAnn?.table !== 'dense_vectors_ann_prose') {
  console.error(`Expected prose ANN table to be dense_vectors_ann_prose, got ${proseResult?.vectorAnn?.table}`);
  process.exit(1);
}

const verify = new Database(dbPath, { readonly: true });
const rows = verify.prepare('SELECT mode, COUNT(*) as count FROM dense_vectors GROUP BY mode').all();
verify.close();

const counts = new Map(rows.map((row) => [row.mode, row.count]));
if (counts.get('code') !== 1 || counts.get('prose') !== 1) {
  console.error(`Expected dense_vectors rows for code=1 and prose=1, got ${JSON.stringify(rows)}`);
  process.exit(1);
}

console.log('embeddings backend resilience test passed');
