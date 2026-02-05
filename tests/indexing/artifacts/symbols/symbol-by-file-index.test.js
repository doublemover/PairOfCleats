#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { enqueueSymbolOccurrencesArtifacts } from '../../../../src/index/build/artifacts/writers/symbol-occurrences.js';
import { enqueueSymbolEdgesArtifacts } from '../../../../src/index/build/artifacts/writers/symbol-edges.js';
import { buildFileMeta } from '../../../../src/index/build/artifacts/file-meta.js';
import {
  loadJsonArrayArtifact,
  loadSymbolOccurrencesByFile,
  loadSymbolEdgesByFile
} from '../../../../src/shared/artifact-io.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'symbol-by-file-index');
const outDir = path.join(tempRoot, 'out');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const makeSymbol = (name, uid, file) => ({
  scheme: 'poc',
  symbolId: `sym:${uid}`,
  scopedId: `scope:${uid}`,
  symbolKey: `symkey:${name}`,
  qualifiedName: name,
  kindGroup: 'function',
  chunkUid: uid,
  languageId: 'javascript',
  file
});

const makeRef = (name, uid) => ({
  v: 1,
  targetName: name,
  kindHint: null,
  importHint: null,
  candidates: [
    {
      symbolId: `sym:${uid}`,
      chunkUid: uid,
      symbolKey: `symkey:${name}`,
      signatureKey: null,
      kindGroup: 'function'
    }
  ],
  status: 'resolved',
  resolved: { symbolId: `sym:${uid}`, chunkUid: uid }
});

const chunks = [
  {
    file: 'src/alpha.js',
    name: 'alpha',
    kind: 'function',
    chunkUid: 'uid-alpha',
    metaV2: {
      file: 'src/alpha.js',
      virtualPath: 'src/alpha.js',
      chunkUid: 'uid-alpha',
      symbol: makeSymbol('alpha', 'uid-alpha', 'src/alpha.js')
    },
    codeRelations: {
      callLinks: [
        {
          v: 1,
          edgeKind: 'call',
          fromChunkUid: 'uid-alpha',
          to: makeRef('beta', 'uid-beta')
        }
      ],
      callDetails: [
        {
          callee: 'beta',
          calleeRef: makeRef('beta', 'uid-beta'),
          start: 0,
          end: 4
        }
      ],
      usageLinks: [
        {
          v: 1,
          edgeKind: 'usage',
          fromChunkUid: 'uid-alpha',
          to: makeRef('beta', 'uid-beta')
        }
      ]
    }
  },
  {
    file: 'src/beta.js',
    name: 'beta',
    kind: 'function',
    chunkUid: 'uid-beta',
    metaV2: {
      file: 'src/beta.js',
      virtualPath: 'src/beta.js',
      chunkUid: 'uid-beta',
      symbol: makeSymbol('beta', 'uid-beta', 'src/beta.js')
    }
  }
];

const { fileMeta, fileIdByPath } = buildFileMeta({ chunks });
const chunkUidToFileId = new Map();
for (const chunk of chunks) {
  const fileId = fileIdByPath.get(chunk.file);
  if (!Number.isFinite(fileId)) continue;
  if (chunk.chunkUid) {
    chunkUidToFileId.set(chunk.chunkUid, fileId);
  }
}

const writes = [];
const enqueueWrite = (label, job) => writes.push({ label, job });
const addPieceFile = () => {};
const formatArtifactLabel = (value) => value;

await enqueueSymbolOccurrencesArtifacts({
  state: { chunks },
  fileIdByPath,
  chunkUidToFileId,
  outDir,
  maxJsonBytes: null,
  compression: null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
});
await enqueueSymbolEdgesArtifacts({
  state: { chunks },
  fileIdByPath,
  chunkUidToFileId,
  outDir,
  maxJsonBytes: null,
  compression: null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
});

for (const { job } of writes) {
  await job();
}

const targetFileId = fileIdByPath.get('src/alpha.js');
assert.ok(Number.isFinite(targetFileId), 'expected fileId for alpha.js');

const allOccurrences = await loadJsonArrayArtifact(outDir, 'symbol_occurrences', { strict: false });
const expectedOccurrences = allOccurrences.filter((row) => row?.host?.file === 'src/alpha.js');
const indexedOccurrences = await loadSymbolOccurrencesByFile(outDir, {
  fileId: targetFileId,
  strict: false
});
assert.deepEqual(indexedOccurrences, expectedOccurrences, 'per-file symbol occurrences should match scan');

const allEdges = await loadJsonArrayArtifact(outDir, 'symbol_edges', { strict: false });
const expectedEdges = allEdges.filter((row) => row?.from?.file === 'src/alpha.js');
const indexedEdges = await loadSymbolEdgesByFile(outDir, {
  fileId: targetFileId,
  strict: false
});
assert.deepEqual(indexedEdges, expectedEdges, 'per-file symbol edges should match scan');

assert.ok(fileMeta.length >= 2, 'expected file_meta entries');
console.log('symbol per-file index test passed');
