import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJsonLinesFile } from '../../../../src/shared/json-stream/jsonl-write.js';
import { writeJsonObjectFile } from '../../../../src/shared/json-stream/json-writers.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../../src/storage/sqlite/build/from-artifacts.js';
import { writePiecesManifest } from '../../../helpers/artifact-io-fixture.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';

export const TOKEN_POSTINGS_STREAMED_CHUNKS = Object.freeze([
  Object.freeze({
    id: 0,
    file: 'src/a.js',
    start: 0,
    end: 8,
    startLine: 1,
    endLine: 1,
    kind: 'code',
    name: 'a',
    tokens: Object.freeze(['alpha', 'beta', 'alpha'])
  }),
  Object.freeze({
    id: 1,
    file: 'src/b.js',
    start: 0,
    end: 6,
    startLine: 1,
    endLine: 1,
    kind: 'code',
    name: 'b',
    tokens: Object.freeze(['beta'])
  })
]);

export const loadSqliteDatabase = async () => {
  const loaded = await import('better-sqlite3');
  return loaded.default;
};

export const setupStreamedTokenPostingsFixture = async ({ tempLabel }) => {
  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, tempLabel);
  const indexDir = path.join(tempRoot, 'index-code');
  const outPath = path.join(tempRoot, 'index-code.db');

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(indexDir, { recursive: true });
  await writeJsonLinesFile(path.join(indexDir, 'chunk_meta.jsonl'), TOKEN_POSTINGS_STREAMED_CHUNKS, { atomic: true });

  return {
    chunks: TOKEN_POSTINGS_STREAMED_CHUNKS,
    indexDir,
    outPath,
    tempRoot
  };
};

export const loadStreamedTokenPostingsIndexPieces = async (indexDir) => loadIndexPieces(indexDir, null);

export const setupTokenPostingsArtifactFixture = async ({
  tempLabel,
  chunks,
  tokenPostings,
  pieceEntries = null
}) => {
  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, tempLabel);
  const indexDir = path.join(tempRoot, 'index-code');
  const outPath = path.join(tempRoot, 'index-code.db');

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(indexDir, { recursive: true });
  await writeJsonLinesFile(path.join(indexDir, 'chunk_meta.jsonl'), chunks, { atomic: true });

  if (tokenPostings?.sharded) {
    const shardDir = path.join(indexDir, 'token_postings.shards');
    await fs.mkdir(shardDir, { recursive: true });
    await writeJsonObjectFile(path.join(shardDir, 'token_postings.part-00000.json'), {
      ...tokenPostings.sharded.part,
      atomic: true
    });
    await writeJsonObjectFile(path.join(indexDir, 'token_postings.meta.json'), {
      ...tokenPostings.sharded.meta,
      atomic: true
    });
  } else if (tokenPostings?.json) {
    await writeJsonObjectFile(path.join(indexDir, 'token_postings.json'), {
      ...tokenPostings.json,
      atomic: true
    });
  }

  await writePiecesManifest(indexDir, pieceEntries || [
    { name: 'chunk_meta', path: 'chunk_meta.jsonl', format: 'jsonl' },
    { name: 'token_postings', path: 'token_postings.json', format: 'json' }
  ]);

  return {
    indexDir,
    outPath,
    tempRoot,
    indexPieces: await loadIndexPieces(indexDir, null)
  };
};

export const buildStreamedTokenPostingsDatabase = async ({
  Database,
  indexPieces,
  indexDir,
  outPath
}) => {
  const warnings = [];
  const count = await buildDatabaseFromArtifacts({
    Database,
    outPath,
    index: indexPieces,
    indexDir,
    mode: 'code',
    manifestFiles: null,
    emitOutput: true,
    validateMode: 'off',
    vectorConfig: { enabled: false },
    modelConfig: { id: null },
    logger: {
      warn: (message) => warnings.push(String(message || '')),
      log: () => {},
      error: () => {}
    }
  });

  return { count, warnings };
};

export const buildTokenPostingsArtifactDatabase = async ({
  Database,
  indexPieces,
  indexDir,
  outPath,
  emitOutput = false
}) => buildDatabaseFromArtifacts({
  Database,
  outPath,
  index: indexPieces,
  indexDir,
  mode: 'code',
  manifestFiles: null,
  emitOutput,
  validateMode: 'off',
  vectorConfig: { enabled: false },
  modelConfig: { id: null }
});

export const readTokenPostingTableTotals = ({ Database, outPath }) => {
  const db = new Database(outPath);
  try {
    return {
      vocabTotal: db.prepare('SELECT COUNT(*) AS total FROM token_vocab WHERE mode = ?').get('code')?.total || 0,
      postingTotal: db.prepare('SELECT COUNT(*) AS total FROM token_postings WHERE mode = ?').get('code')?.total || 0,
      lengthsTotal: db.prepare('SELECT COUNT(*) AS total FROM doc_lengths WHERE mode = ?').get('code')?.total || 0
    };
  } finally {
    db.close();
  }
};
