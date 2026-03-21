#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import {
  writeArtifactPublicationValidationReport,
  resolveArtifactPublicationValidationPath
} from '../../../src/index/build/artifact-publication.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-publication-family-validation-'));

try {
  const buildRoot = path.join(tempRoot, 'build');
  const outDir = path.join(buildRoot, 'index-code');
  const piecesDir = path.join(outDir, 'pieces');
  await fs.mkdir(piecesDir, { recursive: true });

  await writeJsonObjectFile(path.join(outDir, 'chunk_meta.json'), {
    fields: { rows: [] },
    atomic: true
  });
  await writeJsonObjectFile(path.join(outDir, 'file_meta.json'), {
    fields: { rows: [] },
    atomic: true
  });
  await writeJsonObjectFile(path.join(outDir, 'index_state.json'), {
    fields: { stage: 'stage2', buildId: 'build-1' },
    atomic: true
  });
  await writeJsonObjectFile(path.join(outDir, '.filelists.json'), {
    fields: { scanned: { count: 0 } },
    atomic: true
  });

  const pieceEntries = [
    { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' },
    { type: 'chunks', name: 'file_meta', format: 'json', path: 'file_meta.json' },
    { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' },
    { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json' }
  ];
  const manifestPath = path.join(piecesDir, 'manifest.json');
  await writeJsonObjectFile(manifestPath, {
    fields: {
      version: 2,
      pieces: pieceEntries
    },
    atomic: true
  });

  const result = await writeArtifactPublicationValidationReport({
    buildRoot,
    outDir,
    mode: 'code',
    buildId: 'build-1',
    pieceEntries,
    manifestPath,
    familyDeclarations: [
      {
        family: 'fielded-postings',
        owner: 'test',
        requiredMembers: ['field_tokens']
      },
      {
        family: 'core-metadata',
        owner: 'test',
        requiredMembers: ['chunk_meta', 'file_meta', 'index_state', 'filelists']
      }
    ]
  });

  assert.equal(result.validationPath, resolveArtifactPublicationValidationPath(buildRoot, 'code'));
  assert.equal(result.payload.ok, false, 'expected validation report to fail');
  const failedFamily = result.payload.families.find((entry) => entry.family === 'fielded-postings');
  assert.ok(failedFamily, 'expected fielded-postings family entry');
  assert.deepEqual(failedFamily.missingRequiredMembers, ['field_tokens']);
  assert.equal(result.payload.counts.failedFamilies, 1);

  console.log('artifact publication family validation test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
