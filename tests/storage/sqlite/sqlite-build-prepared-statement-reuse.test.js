#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesSharded, writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../src/storage/sqlite/build/from-artifacts.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-build-prepared-statement-reuse');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const mode = 'code';
const chunkCount = 200;
const tokens = ['alpha'];

const createIndexDir = async (dir, shardCount) => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  const chunkIterator = function* chunkIterator() {
    for (let i = 0; i < chunkCount; i += 1) {
      yield {
        id: i,
        file: `src/file-${i % 3}.js`,
        start: 0,
        end: 10,
        startLine: 1,
        endLine: 1,
        kind: mode,
        name: `fn${i}`,
        tokens
      };
    }
  };

  const shardResult = await writeJsonLinesSharded({
    dir,
    partsDirName: 'chunk_meta.parts',
    partPrefix: 'chunk_meta.part-',
    items: chunkIterator(),
    maxBytes: 4096,
    atomic: true
  });
  await writeJsonObjectFile(path.join(dir, 'chunk_meta.meta.json'), {
    fields: {
      schemaVersion: '0.0.1',
      artifact: 'chunk_meta',
      format: 'jsonl-sharded',
      generatedAt: new Date().toISOString(),
      compression: 'none',
      totalRecords: shardResult.total,
      totalBytes: shardResult.totalBytes,
      maxPartRecords: shardResult.maxPartRecords,
      maxPartBytes: shardResult.maxPartBytes,
      targetMaxBytes: shardResult.targetMaxBytes,
      parts: shardResult.parts.map((part, index) => ({
        path: part,
        records: shardResult.counts[index] || 0,
        bytes: shardResult.bytes[index] || 0
      }))
    },
    atomic: true
  });

  const postingsDir = path.join(dir, 'token_postings.shards');
  await fs.mkdir(postingsDir, { recursive: true });

  const parts = [];
  for (let shard = 0; shard < shardCount; shard += 1) {
    const name = `token_postings.part-${String(shard).padStart(5, '0')}.json`;
    const fullPath = path.join(postingsDir, name);
    parts.push(`token_postings.shards/${name}`);
    // Keep postings small; shard count should not impact prepare count.
    await writeJsonObjectFile(fullPath, {
      arrays: {
        vocab: [`tok${shard}`],
        postings: [[[0, 1]]]
      },
      atomic: true
    });
  }

  const docLengths = Array.from({ length: chunkCount }, () => tokens.length);
  await writeJsonObjectFile(path.join(dir, 'token_postings.meta.json'), {
    fields: {
      avgDocLen: tokens.length,
      totalDocs: chunkCount,
      format: 'sharded',
      shardSize: shardCount,
      vocabCount: shardCount,
      parts
    },
    arrays: { docLengths },
    atomic: true
  });
};

const runBuild = async ({ indexDir, outPath }) => {
  const indexPieces = await loadIndexPieces(indexDir, null);
  assert.ok(indexPieces, `expected loadIndexPieces to detect artifacts in ${indexDir}`);

  const stats = {};
  await buildDatabaseFromArtifacts({
    Database,
    outPath,
    index: indexPieces,
    indexDir,
    mode,
    manifestFiles: null,
    emitOutput: false,
    validateMode: 'off',
    vectorConfig: { enabled: false },
    modelConfig: { id: null },
    statementStrategy: 'prepared',
    buildPragmas: false,
    optimize: false,
    stats
  });
  const prepares = stats?.prepare?.total ?? null;
  assert.ok(Number.isFinite(prepares), 'expected stats.prepare.total to be recorded');
  return prepares;
};

const dirOne = path.join(tempRoot, 'index-one');
const dirMany = path.join(tempRoot, 'index-many');
await createIndexDir(dirOne, 1);
await createIndexDir(dirMany, 12);

const preparesOne = await runBuild({
  indexDir: dirOne,
  outPath: path.join(tempRoot, 'one.db')
});
const preparesMany = await runBuild({
  indexDir: dirMany,
  outPath: path.join(tempRoot, 'many.db')
});

assert.equal(
  preparesMany,
  preparesOne,
  `expected prepare count to be stable across shard counts (one=${preparesOne}, many=${preparesMany})`
);

console.log('sqlite prepared statement reuse test passed');

