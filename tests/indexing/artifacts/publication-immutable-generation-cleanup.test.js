#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { prepareArtifactCleanup } from '../../../src/index/build/artifacts-write/family-dispatch.js';
import {
  resolveCommittedArtifactPaths,
  writeArtifactPublicationRecord,
  writeArtifactPublicationValidationReport
} from '../../../src/index/build/artifact-publication.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-publication-immutable-cleanup-'));

try {
  const buildRoot = path.join(tempRoot, 'build');
  const outDir = path.join(buildRoot, 'index-code');
  const piecesDir = path.join(outDir, 'pieces');
  await fs.mkdir(piecesDir, { recursive: true });

  const chunkMetaPath = path.join(outDir, 'chunk_meta.json');
  const manifestPath = path.join(piecesDir, 'manifest.json');
  const pieceEntries = [
    { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' }
  ];

  await writeJsonObjectFile(chunkMetaPath, {
    fields: { rows: [] },
    atomic: true
  });
  await writeJsonObjectFile(manifestPath, {
    fields: { version: 2, pieces: pieceEntries },
    atomic: true
  });

  const validation = await writeArtifactPublicationValidationReport({
    buildRoot,
    outDir,
    mode: 'code',
    buildId: 'build-1',
    pieceEntries,
    manifestPath,
    familyDeclarations: [
      {
        family: 'core',
        owner: 'test',
        requiredMembers: ['chunk_meta']
      }
    ]
  });
  assert.equal(validation.payload.ok, true);

  const indexState = {};
  const cleanup = await prepareArtifactCleanup({
    outDir,
    log: () => {},
    logLine: () => {},
    vectorOnlyProfile: false,
    tokenPostingsFormat: 'json',
    tokenPostingsUseShards: false,
    effectiveAbortSignal: null,
    indexState,
    profileId: 'test-profile',
    removePieceFile: () => {}
  });

  await cleanup.removeArtifact(chunkMetaPath, { policy: 'legacy' });
  const summary = await cleanup.commitArtifactCleanup({
    immutablePaths: resolveCommittedArtifactPaths({
      buildRoot,
      outDir,
      pieceEntries,
      manifestPath
    })
  });

  assert.equal(summary.completedActions, 0);
  assert.equal(summary.failedActions, 1);
  assert.match(summary.failures[0].message, /refusing to remove committed artifact/i);
  await fs.access(chunkMetaPath);

  await writeArtifactPublicationRecord({
    buildRoot,
    outDir,
    mode: 'code',
    stage: 'stage2',
    buildId: 'build-1',
    pieceEntries,
    manifestPath,
    publicationValidation: validation,
    cleanup: summary,
    status: 'validated'
  });

  console.log('artifact publication immutable cleanup test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
