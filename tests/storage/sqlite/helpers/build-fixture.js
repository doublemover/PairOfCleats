import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJsonLinesSharded } from '../../../../src/shared/json-stream/jsonl-sharded.js';
import { writeJsonObjectFile } from '../../../../src/shared/json-stream/json-writers.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../../src/storage/sqlite/build/from-artifacts.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { writePiecesManifest } from '../../../helpers/artifact-io-fixture.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

export const SQLITE_BUILD_FIXTURE_DEFAULT_TOKENS = Object.freeze(['alpha', 'beta']);

export const loadDatabaseCtor = async () => {
  try {
    const loaded = await import('better-sqlite3');
    return loaded.default;
  } catch (err) {
    throw new Error(`better-sqlite3 missing: ${err?.message || err}`);
  }
};

export function* createSqliteBuildFixtureChunks({
  chunkCount,
  fileCount = 3,
  mode = 'code',
  tokens = SQLITE_BUILD_FIXTURE_DEFAULT_TOKENS,
  decorateChunk = null
}) {
  for (let i = 0; i < chunkCount; i += 1) {
    const chunk = {
      id: i,
      file: `src/file-${i % fileCount}.js`,
      start: 0,
      end: 10,
      startLine: 1,
      endLine: 1,
      kind: mode,
      name: `fn${i}`,
      tokens
    };
    const extra = typeof decorateChunk === 'function' ? decorateChunk(chunk, i) : null;
    yield extra && typeof extra === 'object' ? { ...chunk, ...extra } : chunk;
  }
}

export const createSqliteShardFixturePieceEntries = (shardResult) => [
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
];

export const writeSqliteShardFixtureArtifacts = async ({
  indexDir,
  chunkCount,
  fileCount = 3,
  mode = 'code',
  tokens = SQLITE_BUILD_FIXTURE_DEFAULT_TOKENS,
  tokenVocab = [tokens[0] || 'alpha'],
  tokenPostings = null,
  docLengths = null,
  avgDocLen = null,
  tokenShardSize = null,
  chunkMaxBytes = 4096,
  compression = 'none',
  decorateChunk = null
}) => {
  const shardResult = await writeJsonLinesSharded({
    dir: indexDir,
    partsDirName: 'chunk_meta.parts',
    partPrefix: 'chunk_meta.part-',
    items: createSqliteBuildFixtureChunks({
      chunkCount,
      fileCount,
      mode,
      tokens,
      decorateChunk
    }),
    maxBytes: chunkMaxBytes,
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
  const resolvedTokenPostings = Array.isArray(tokenPostings)
    ? tokenPostings
    : tokenVocab.map(() => postingsEntries);
  await writeJsonObjectFile(postingsPart, {
    arrays: {
      vocab: tokenVocab,
      postings: resolvedTokenPostings
    },
    atomic: true
  });
  const resolvedDocLengths = Array.isArray(docLengths)
    ? docLengths
    : Array.from({ length: chunkCount }, () => tokens.length);
  await writeJsonObjectFile(path.join(indexDir, 'token_postings.meta.json'), {
    fields: {
      avgDocLen: avgDocLen ?? tokens.length,
      totalDocs: chunkCount,
      format: 'sharded',
      shardSize: tokenShardSize ?? Math.max(1, tokenVocab.length),
      vocabCount: tokenVocab.length,
      parts: ['token_postings.shards/token_postings.part-00000.json']
    },
    arrays: { docLengths: resolvedDocLengths },
    atomic: true
  });

  return {
    shardResult,
    pieceEntries: createSqliteShardFixturePieceEntries(shardResult),
    tokens
  };
};

export const setupSqliteBuildFixture = async ({
  tempLabel,
  chunkCount,
  fileCount = 3,
  mode = 'code',
  tokens = SQLITE_BUILD_FIXTURE_DEFAULT_TOKENS,
  tokenVocab = [tokens[0] || 'alpha'],
  tokenPostings = null,
  docLengths = null,
  avgDocLen = null,
  tokenShardSize = null,
  chunkMaxBytes = 4096,
  compression = 'none',
  decorateChunk = null,
  includeRowcountArtifacts = false
}) => {
  applyTestEnv({ testing: '1' });

  const Database = await loadDatabaseCtor();
  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, tempLabel);
  const indexDir = path.join(tempRoot, 'index-code');
  const outPath = path.join(tempRoot, 'index-code.db');

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(indexDir, { recursive: true });

  const { shardResult, pieceEntries } = await writeSqliteShardFixtureArtifacts({
    indexDir,
    chunkCount,
    fileCount,
    mode,
    tokens,
    tokenVocab,
    tokenPostings,
    docLengths,
    avgDocLen,
    tokenShardSize,
    chunkMaxBytes,
    compression,
    decorateChunk
  });

  let phraseDocIds = [];
  if (includeRowcountArtifacts) {
    for (let i = 0; i < chunkCount; i += 2) phraseDocIds.push(i);
    await writeJsonObjectFile(path.join(indexDir, 'phrase_ngrams.json'), {
      arrays: {
        vocab: ['alpha beta'],
        postings: [phraseDocIds]
      },
      atomic: true
    });

    await writeJsonObjectFile(path.join(indexDir, 'chargram_postings.json'), {
      arrays: {
        vocab: ['ab', 'bc'],
        postings: [
          [0, 1, 2],
          [2, 3]
        ]
      },
      atomic: true
    });

    await writeJsonObjectFile(path.join(indexDir, 'minhash_signatures.json'), {
      arrays: {
        signatures: Array.from({ length: chunkCount }, (_, i) => [i, i + 1, i + 2])
      },
      atomic: true
    });

    await writeJsonObjectFile(path.join(indexDir, 'dense_vectors_uint8.json'), {
      fields: {
        dims: 2,
        model: 'stub',
        scale: 1.0
      },
      arrays: {
        vectors: Array.from({ length: chunkCount }, (_, i) => [i % 256, (i + 1) % 256])
      },
      atomic: true
    });
    pieceEntries.push(
      { name: 'phrase_ngrams', path: 'phrase_ngrams.json', format: 'json' },
      { name: 'chargram_postings', path: 'chargram_postings.json', format: 'json' },
      { name: 'minhash_signatures', path: 'minhash_signatures.json', format: 'json' },
      { name: 'dense_vectors_uint8', path: 'dense_vectors_uint8.json', format: 'json' }
    );
  }
  await writePiecesManifest(indexDir, pieceEntries);

  const indexPieces = await loadIndexPieces(indexDir, null);
  const count = await buildDatabaseFromArtifacts({
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
    optimize: false
  });

  return {
    Database,
    tempRoot,
    indexDir,
    outPath,
    mode,
    count,
    chunkCount,
    fileCount,
    shardResult,
    phraseDocIds,
    indexPieces
  };
};

