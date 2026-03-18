import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { writeArtifactPublicationRecord } from '../../src/index/build/artifact-publication.js';

export const seedPublishedArtifacts = async ({
  buildRoot,
  mode = 'code',
  buildId = path.basename(buildRoot),
  stage = 'stage2'
} = {}) => {
  const outDir = path.join(buildRoot, `index-${mode}`);
  const piecesDir = path.join(outDir, 'pieces');
  await fs.mkdir(piecesDir, { recursive: true });
  const chunkMetaPath = path.join(outDir, 'chunk_meta.json');
  const tokenPostingsPath = path.join(outDir, 'token_postings.json');
  await writeJsonObjectFile(chunkMetaPath, {
    fields: { rows: [] },
    atomic: true
  });
  await writeJsonObjectFile(tokenPostingsPath, {
    fields: { rows: [] },
    atomic: true
  });
  const pieceEntries = [
    { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' },
    { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' }
  ];
  const manifestPath = path.join(piecesDir, 'manifest.json');
  await writeJsonObjectFile(manifestPath, {
    fields: {
      version: 2,
      mode,
      stage,
      buildId,
      pieces: pieceEntries
    },
    atomic: true
  });
  await writeArtifactPublicationRecord({
    buildRoot,
    outDir,
    mode,
    stage,
    buildId,
    pieceEntries,
    manifestPath
  });
  return { outDir, manifestPath, pieceEntries };
};
