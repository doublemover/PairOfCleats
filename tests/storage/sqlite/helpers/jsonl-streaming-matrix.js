import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import { tryRequire } from '../../../../src/shared/optional-deps.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../../src/storage/sqlite/build/from-artifacts.js';
import { skip } from '../../../helpers/skip.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { writePiecesManifest } from '../../../helpers/artifact-io-fixture.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';
import {
  loadDatabaseCtor,
  writeSqliteShardFixtureArtifacts
} from './build-fixture.js';

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
  const tempRoot = resolveTestCachePath(root, tempLabel);
  const indexDir = path.join(tempRoot, 'index-code');
  const outPath = path.join(tempRoot, 'index-code.db');

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(indexDir, { recursive: true });

  const chunkCount = 600;
  const tokens = ['alpha', 'beta'];

  const { shardResult, pieceEntries } = await writeSqliteShardFixtureArtifacts({
    indexDir,
    chunkCount,
    fileCount: 10,
    mode: 'code',
    tokens,
    chunkMaxBytes: 8192,
    compression,
    tokenVocab: ['alpha']
  });
  await writePiecesManifest(indexDir, pieceEntries);

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
