import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJsonLinesSharded, writeJsonObjectFile } from '../../../../src/shared/json-stream.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../../src/storage/sqlite/build/from-artifacts.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

const loadDatabaseCtor = async () => {
  try {
    const loaded = await import('better-sqlite3');
    return loaded.default;
  } catch (err) {
    throw new Error(`better-sqlite3 missing: ${err?.message || err}`);
  }
};

export const setupSqliteBuildFixture = async ({
  tempLabel,
  chunkCount,
  fileCount = 3,
  mode = 'code',
  includeRowcountArtifacts = false
}) => {
  applyTestEnv({ testing: '1' });

  const Database = await loadDatabaseCtor();
  const root = process.cwd();
  const tempRoot = path.join(root, '.testCache', tempLabel);
  const indexDir = path.join(tempRoot, 'index-code');
  const outPath = path.join(tempRoot, 'index-code.db');

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(indexDir, { recursive: true });

  const tokens = ['alpha', 'beta'];
  const chunkIterator = function* chunkIterator() {
    for (let i = 0; i < chunkCount; i += 1) {
      yield {
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
    }
  };

  const shardResult = await writeJsonLinesSharded({
    dir: indexDir,
    partsDirName: 'chunk_meta.parts',
    partPrefix: 'chunk_meta.part-',
    items: chunkIterator(),
    maxBytes: 4096,
    atomic: true
  });
  await writeJsonObjectFile(path.join(indexDir, 'chunk_meta.meta.json'), {
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
  }

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
    outPath,
    mode,
    count,
    chunkCount,
    fileCount,
    phraseDocIds,
    indexPieces
  };
};

