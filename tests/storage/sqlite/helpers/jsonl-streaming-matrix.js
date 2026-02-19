import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import { writeJsonLinesSharded, writeJsonObjectFile } from '../../../../src/shared/json-stream.js';
import { tryRequire } from '../../../../src/shared/optional-deps.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../../src/storage/sqlite/build/from-artifacts.js';
import { skip } from '../../../helpers/skip.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { writePiecesManifest } from '../../../helpers/artifact-io-fixture.js';

const loadDatabaseCtor = async () => {
  try {
    const loaded = await import('better-sqlite3');
    return loaded.default;
  } catch (err) {
    throw new Error(`better-sqlite3 missing: ${err?.message || err}`);
  }
};

const ensureCompressionSupport = (compression) => {
  if (compression === 'zstd' && !tryRequire('@mongodb-js/zstd').ok) {
    skip('zstd not available; skipping sqlite jsonl streaming zstd test.');
  }
};

const resolveCompressionExtension = (compression) => {
  if (compression === 'gzip') return '.jsonl.gz';
  if (compression === 'zstd') return '.jsonl.zst';
  return '.jsonl';
};

export const runSqliteJsonlStreamingCompressionCase = async ({
  compression,
  tempLabel
}) => {
  applyTestEnv();

  const Database = await loadDatabaseCtor();
  ensureCompressionSupport(compression);

  const root = process.cwd();
  const tempRoot = path.join(root, '.testCache', tempLabel);
  const indexDir = path.join(tempRoot, 'index-code');
  const outPath = path.join(tempRoot, 'index-code.db');

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(indexDir, { recursive: true });

  const chunkCount = 600;
  const tokens = ['alpha', 'beta'];
  const chunkIterator = function* chunkIterator() {
    for (let i = 0; i < chunkCount; i += 1) {
      yield {
        id: i,
        file: `src/file-${i % 10}.js`,
        start: 0,
        end: 10,
        startLine: 1,
        endLine: 1,
        kind: 'code',
        name: `fn${i}`,
        tokens
      };
    }
  };

  const shardResult = await writeJsonLinesSharded({
    dir: indexDir,
    partsDirName: 'chunk_meta.parts',
    partPrefix: 'chunk_meta.part-',
    items: chunkIterator(),
    maxBytes: 8192,
    compression,
    atomic: true
  });

  await writeJsonObjectFile(path.join(indexDir, 'chunk_meta.meta.json'), {
    fields: {
      schemaVersion: '0.0.1',
      artifact: 'chunk_meta',
      format: 'jsonl-sharded',
      generatedAt: new Date().toISOString(),
      compression,
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

  const postingsDir = path.join(indexDir, 'token_postings.shards');
  await fs.mkdir(postingsDir, { recursive: true });
  const postingsPart = path.join(postingsDir, 'token_postings.part-00000.json');
  const postingsEntries = Array.from({ length: chunkCount }, (_, i) => [i, 1]);
  await writeJsonObjectFile(postingsPart, {
    arrays: {
      vocab: ['alpha'],
      postings: [postingsEntries]
    },
    atomic: true
  });
  const docLengths = Array.from({ length: chunkCount }, () => tokens.length);
  await writeJsonObjectFile(path.join(indexDir, 'token_postings.meta.json'), {
    fields: {
      avgDocLen: tokens.length,
      totalDocs: chunkCount,
      format: 'sharded',
      shardSize: 1,
      vocabCount: 1,
      parts: ['token_postings.shards/token_postings.part-00000.json']
    },
    arrays: { docLengths },
    atomic: true
  });
  await writePiecesManifest(indexDir, [
    ...shardResult.parts.map((part) => ({
      name: 'chunk_meta',
      path: part,
      format: 'jsonl'
    })),
    { name: 'chunk_meta_meta', path: 'chunk_meta.meta.json', format: 'json' },
    {
      name: 'token_postings',
      path: 'token_postings.shards/token_postings.part-00000.json',
      format: 'sharded'
    },
    { name: 'token_postings_meta', path: 'token_postings.meta.json', format: 'json' }
  ]);

  const indexPieces = await loadIndexPieces(indexDir, null);
  const count = await buildDatabaseFromArtifacts({
    Database,
    outPath,
    index: indexPieces,
    indexDir,
    mode: 'code',
    manifestFiles: null,
    emitOutput: false,
    validateMode: 'off',
    vectorConfig: { enabled: false },
    modelConfig: { id: null }
  });

  const db = new Database(outPath);
  const row = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get('code');
  db.close();

  return {
    chunkCount,
    shardResult,
    expectedPartExtension: resolveCompressionExtension(compression),
    outPathExists: fsSync.existsSync(outPath),
    count,
    rowTotal: row?.total ?? null,
    indexPieces
  };
};
