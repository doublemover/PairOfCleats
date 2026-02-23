#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createChunkMetaIterator, enqueueChunkMetaArtifacts } from '../../../../src/index/build/artifacts/writers/chunk-meta.js';
import { enqueueFileRelationsArtifacts } from '../../../../src/index/build/artifacts/writers/file-relations.js';
import { enqueueCallSitesArtifacts } from '../../../../src/index/build/artifacts/writers/call-sites.js';
import { validateArtifact } from '../../../../src/shared/artifact-schemas.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'sharded-meta-schema');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const runChunkMeta = async (outDir) => {
  const chunks = [
    { id: 0, file: 'alpha.js', start: 0, end: 1, startLine: 1, endLine: 1, kind: 'code' },
    { id: 1, file: 'beta.js', start: 0, end: 2, startLine: 1, endLine: 1, kind: 'code' }
  ];
  const chunkMetaIterator = createChunkMetaIterator({
    chunks,
    fileIdByPath: new Map(),
    resolvedTokenMode: 'none',
    tokenSampleSize: 0
  });
  const writes = [];
  const enqueueWrite = (label, job) => writes.push({ label, job });
  const enqueueJsonArray = () => {
    throw new Error('Unexpected enqueueJsonArray for sharded chunk_meta');
  };
  const addPieceFile = () => {};
  const formatArtifactLabel = (value) => value;
  await enqueueChunkMetaArtifacts({
    state: { chunks },
    outDir,
    chunkMetaIterator,
    chunkMetaPlan: {
      chunkMetaUseJsonl: true,
      chunkMetaUseShards: true,
      chunkMetaShardSize: 1,
      chunkMetaCount: chunks.length
    },
    enqueueJsonArray,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });
  for (const { job } of writes) {
    await job();
  }
  return path.join(outDir, 'chunk_meta.meta.json');
};

const runFileRelations = async (outDir) => {
  const relations = new Map([
    ['alpha.js', { calls: ['beta.js'] }],
    ['beta.js', { calls: [] }]
  ]);
  const writes = [];
  const enqueueWrite = (label, job) => writes.push({ label, job });
  const addPieceFile = () => {};
  const formatArtifactLabel = (value) => value;
  await enqueueFileRelationsArtifacts({
    state: { fileRelations: relations },
    outDir,
    maxJsonBytes: 80,
    compression: null,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });
  for (const { job } of writes) {
    await job();
  }
  return path.join(outDir, 'file_relations.meta.json');
};

const runCallSites = async (outDir) => {
  const chunks = [
    {
      id: 0,
      file: 'alpha.ts',
      lang: 'typescript',
      chunkUid: 'ck:alpha',
      virtualPath: 'alpha.ts',
      codeRelations: {
        callDetails: [
          {
            caller: 'alpha',
            callee: 'beta',
            start: 0,
            end: 4,
            startLine: 1,
            startCol: 1,
            endLine: 1,
            endCol: 5,
            args: ['foo']
          },
          {
            caller: 'alpha',
            callee: 'gamma',
            start: 6,
            end: 10,
            startLine: 1,
            startCol: 7,
            endLine: 1,
            endCol: 11,
            args: ['bar', 'baz']
          }
        ]
      }
    }
  ];
  const writes = [];
  const enqueueWrite = (label, job) => writes.push({ label, job });
  const addPieceFile = () => {};
  const formatArtifactLabel = (value) => value;
  await enqueueCallSitesArtifacts({
    state: { chunks },
    outDir,
    maxJsonBytes: 512,
    compression: null,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });
  for (const { job } of writes) {
    await job();
  }
  return path.join(outDir, 'call_sites.meta.json');
};

const chunkMetaDir = path.join(cacheRoot, 'chunk-meta');
await fs.mkdir(chunkMetaDir, { recursive: true });
const chunkMetaPath = await runChunkMeta(chunkMetaDir);
const chunkMeta = JSON.parse(await fs.readFile(chunkMetaPath, 'utf8'));
const chunkMetaValidation = validateArtifact('chunk_meta_meta', chunkMeta);
assert.ok(chunkMetaValidation.ok, `chunk_meta_meta invalid: ${chunkMetaValidation.errors.join('; ')}`);

const relationsDir = path.join(cacheRoot, 'file-relations');
await fs.mkdir(relationsDir, { recursive: true });
const relationsPath = await runFileRelations(relationsDir);
const relationsMeta = JSON.parse(await fs.readFile(relationsPath, 'utf8'));
const relationsValidation = validateArtifact('file_relations_meta', relationsMeta);
assert.ok(relationsValidation.ok, `file_relations_meta invalid: ${relationsValidation.errors.join('; ')}`);

const callSitesDir = path.join(cacheRoot, 'call-sites');
await fs.mkdir(callSitesDir, { recursive: true });
const callSitesPath = await runCallSites(callSitesDir);
const callSitesMeta = JSON.parse(await fs.readFile(callSitesPath, 'utf8'));
const callSitesValidation = validateArtifact('call_sites_meta', callSitesMeta);
assert.ok(callSitesValidation.ok, `call_sites_meta invalid: ${callSitesValidation.errors.join('; ')}`);

console.log('sharded meta schema test passed');

