import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';

export const defaultUserConfig = {
  indexing: {
    postings: {
      enablePhraseNgrams: false,
      enableChargrams: false,
      fielded: false
    }
  },
  search: { annDefault: false },
  sqlite: { use: false },
  lmdb: { use: false }
};

export const createBaseIndex = async ({
  rootDir,
  manifestPieces = null,
  manifestOverrides = {},
  chunkMeta = null,
  tokenPostings = null,
  indexState = null,
  fileLists = null
} = {}) => {
  const repoRoot = rootDir;
  const indexRoot = path.join(rootDir, '.index-root');
  const indexDir = path.join(indexRoot, 'index-code');
  await fs.mkdir(indexDir, { recursive: true });

  const chunkMetaPayload = chunkMeta || [{ id: 0, file: 'src/a.js', start: 0, end: 1 }];
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(chunkMetaPayload, null, 2));

  const tokenPostingsPayload = tokenPostings || {
    vocab: ['alpha'],
    postings: [[[0, 1]]],
    docLengths: [1],
    avgDocLen: 1,
    totalDocs: 1
  };
  await fs.writeFile(path.join(indexDir, 'token_postings.json'), JSON.stringify(tokenPostingsPayload, null, 2));

  const indexStatePayload = indexState || {
    generatedAt: new Date().toISOString(),
    mode: 'code',
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION
  };
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify(indexStatePayload, null, 2));

  const fileListsPayload = fileLists || {
    generatedAt: new Date().toISOString(),
    scanned: { count: 1, sample: [] },
    skipped: { count: 0, sample: [] }
  };
  await fs.writeFile(path.join(indexDir, '.filelists.json'), JSON.stringify(fileListsPayload, null, 2));

  const pieces = manifestPieces || [
    { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' },
    { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
    { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' },
    { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json' }
  ];

  const manifest = {
    version: 2,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    pieces,
    ...manifestOverrides
  };

  await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
  await fs.writeFile(
    path.join(indexDir, 'pieces', 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  return { repoRoot, indexRoot, indexDir, manifest };
};
