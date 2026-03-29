#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getMetricsText } from '../../../src/shared/metrics/core.js';
import { updateSqliteDense } from '../../../tools/build/embeddings/sqlite-dense.js';
import { getExtensionsDir } from '../../../tools/shared/dict-utils.js';
import { getVectorExtensionConfig, queryVectorAnn } from '../../../tools/sqlite/vector-extension.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'vector-extension-contract-matrix');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

{
  const config = getVectorExtensionConfig(tempRoot, null, {
    enabled: true,
    table: 'dense_vectors_ann; DROP TABLE chunks; --'
  });
  assert.equal(config.enabled, false);
  assert.ok(config.disabledReason);

  const traversal = getVectorExtensionConfig(tempRoot, null, {
    dir: path.join('..', 'outside-extensions'),
    path: path.join('..', 'outside-extensions', 'vec0.dll')
  });
  assert.equal(traversal.path, null);
  assert.equal(traversal.dir, getExtensionsDir(tempRoot, {}));

  const absolutePath = path.resolve(tempRoot, 'extensions', 'vec0.dll');
  const absoluteOverride = getVectorExtensionConfig(tempRoot, null, { path: absolutePath });
  assert.equal(absoluteOverride.path, absolutePath);
}

{
  const captured = [];
  const db = {
    prepare(sql) {
      assert.ok(sql.includes('MATCH ?'));
      return {
        all(...params) {
          captured.push(params[0]);
          return [];
        }
      };
    }
  };
  const baseConfig = {
    enabled: true,
    table: 'dense_vectors_ann',
    column: 'embedding',
    encoding: 'float32',
    dims: 4
  };
  queryVectorAnn(db, baseConfig, [1, 2], 5, null);
  queryVectorAnn(db, baseConfig, [1, 2, 3, 4, 5], 5, null);
  assert.equal(captured.length, 2);
  assert.deepEqual(Array.from(new Float32Array(captured[0].buffer, captured[0].byteOffset, captured[0].byteLength / 4)), [1, 2, 0, 0]);
  assert.deepEqual(Array.from(new Float32Array(captured[1].buffer, captured[1].byteOffset, captured[1].byteLength / 4)), [1, 2, 3, 4]);
}

{
  const sqlStatements = [];
  const inserted = [];
  let queryParams = null;
  const db = {
    exec(sql) {
      sqlStatements.push(sql);
    },
    prepare(sql) {
      sqlStatements.push(sql);
      if (sql.startsWith('INSERT OR IGNORE')) {
        return {
          run(id) {
            inserted.push(id);
          }
        };
      }
      return {
        all(...params) {
          queryParams = params;
          return [];
        }
      };
    },
    transaction(fn) {
      return (...args) => fn(...args);
    }
  };

  const candidateSet = new Set(Array.from({ length: 1200 }, (_, i) => i));
  const config = {
    enabled: true,
    table: 'dense_vectors_ann',
    column: 'embedding',
    encoding: 'float32',
    dims: 4
  };
  queryVectorAnn(db, config, [1, 2, 3, 4], 7, candidateSet);
  assert.ok(sqlStatements.some((sql) => sql.includes('CREATE TEMP TABLE IF NOT EXISTS __poc_ann_candidates_')));
  assert.ok(sqlStatements.some((sql) => sql.includes('IN (SELECT id FROM __poc_ann_candidates_')));
  assert.ok(sqlStatements.some((sql) => sql.includes('DROP TABLE IF EXISTS __poc_ann_candidates_')));
  assert.equal(inserted.length, candidateSet.size);
  assert.ok(Array.isArray(queryParams) && queryParams.length === 2);
  assert.equal(queryParams[1], 7);
  const metrics = await getMetricsText();
  assert.match(metrics, /pairofcleats_ann_candidate_pushdown_total\{backend="sqlite-vector",strategy="temp-table",size_bucket="1025\+"\} 1/);
}

{
  let Database = null;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch {
    Database = null;
  }

  if (Database) {
    const repoRoot = path.join(tempRoot, 'repo');
    const cacheRoot = path.join(tempRoot, 'cache');
    await fs.mkdir(repoRoot, { recursive: true });
    await fs.mkdir(cacheRoot, { recursive: true });
    applyTestEnv();
    process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
    const userConfig = { cache: { root: cacheRoot } };
    const dbPath = path.join(repoRoot, 'index.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE dense_vectors (mode TEXT, doc_id INTEGER, vector BLOB)');
    db.exec('CREATE TABLE dense_meta (mode TEXT, dims INTEGER, scale REAL, model TEXT)');
    db.close();

    const result = updateSqliteDense({
      Database,
      root: repoRoot,
      userConfig,
      indexRoot: null,
      mode: 'code',
      vectors: [new Uint8Array([128, 128])],
      dims: 2,
      scale: 2 / 255,
      modelId: 'test',
      dbPath,
      emitOutput: false,
      logger: { log: () => {}, warn: () => {}, error: () => {} }
    });
    assert.notEqual(result?.skipped, true);

    const verify = new Database(dbPath);
    const count = verify.prepare('SELECT COUNT(*) AS total FROM dense_vectors').get().total;
    verify.close();
    assert.equal(count, 1);
  }
}

console.log('vector extension contract matrix test passed');
