#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import {
  readArtifactPublicationRecord,
  resolveArtifactPublicationPath,
  resolveArtifactPublicationValidationPath,
  writeArtifactPublicationValidationReport,
  writeArtifactPublicationRecord
} from '../../../src/index/build/artifact-publication.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-artifact-publication-'));

try {
  const buildRoot = path.join(tempRoot, 'build');
  const outDir = path.join(buildRoot, 'index-code');
  const piecesDir = path.join(outDir, 'pieces');
  await fs.mkdir(piecesDir, { recursive: true });

  const manifestPath = path.join(piecesDir, 'manifest.json');
  await writeJsonObjectFile(manifestPath, {
    fields: { version: 2, pieces: [] },
    atomic: true
  });

  await assert.rejects(
    () => writeArtifactPublicationRecord({
      buildRoot,
      outDir,
      mode: 'code',
      pieceEntries: [{ type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' }],
      manifestPath
    }),
    /missing committed artifact/
  );

  const chunkMetaPath = path.join(outDir, 'chunk_meta.json');
  await writeJsonObjectFile(chunkMetaPath, {
    fields: { rows: [] },
    atomic: true
  });

  const result = await writeArtifactPublicationRecord({
    buildRoot,
    outDir,
    mode: 'code',
    buildId: 'build-1',
    stage: 'stage2',
    pieceEntries: [{ type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' }],
    manifestPath,
    publicationValidation: await writeArtifactPublicationValidationReport({
      buildRoot,
      outDir,
      mode: 'code',
      buildId: 'build-1',
      pieceEntries: [{ type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' }],
      manifestPath,
      familyDeclarations: [
        {
          family: 'core',
          owner: 'test',
          requiredMembers: ['chunk_meta']
        }
      ]
    })
  });

  assert.equal(result.publicationPath, resolveArtifactPublicationPath(buildRoot, 'code'));
  const publication = await readArtifactPublicationRecord(buildRoot, 'code');
  assert.equal(publication.status, 'published');
  assert.equal(publication.mode, 'code');
  assert.equal(publication.buildId, 'build-1');
  assert.equal(publication.generationId, 'build-1');
  assert.equal(publication.pieceCount, 1);
  assert.equal(publication.publicationValidation?.ok, true);
  assert.equal(
    publication.publicationValidation?.validationPath,
    resolveArtifactPublicationValidationPath(buildRoot, 'code')
  );

  console.log('artifact publication record contract test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
