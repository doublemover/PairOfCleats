#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { enqueueSymbolsArtifacts } from '../../../src/index/build/artifacts/writers/symbols.js';
import { enqueueSymbolOccurrencesArtifacts } from '../../../src/index/build/artifacts/writers/symbol-occurrences.js';
import { enqueueSymbolEdgesArtifacts } from '../../../src/index/build/artifacts/writers/symbol-edges.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'symbol-artifacts-smoke');
await fs.rm(outDir, { recursive: true, force: true });
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

const writes = [];
const pieceEntries = [];
const enqueueWrite = (label, job) => writes.push({ label, job });
const addPieceFile = (entry, filePath) => pieceEntries.push({ entry, filePath });
const formatArtifactLabel = (value) => value;

await enqueueSymbolsArtifacts({
  state: { chunks },
  outDir,
  maxJsonBytes: null,
  compression: null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
});
await enqueueSymbolOccurrencesArtifacts({
  state: { chunks },
  outDir,
  maxJsonBytes: null,
  compression: null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
});
await enqueueSymbolEdgesArtifacts({
  state: { chunks },
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

const expectFile = async (relPath) => {
  const absPath = path.join(outDir, relPath);
  await fs.access(absPath);
};

await expectFile('symbols.jsonl');
await expectFile('symbol_occurrences.jsonl');
await expectFile('symbol_edges.jsonl');

const names = new Set(pieceEntries.map((piece) => piece.entry?.name));
assert.ok(names.has('symbols'), 'expected symbols piece');
assert.ok(names.has('symbol_occurrences'), 'expected symbol_occurrences piece');
assert.ok(names.has('symbol_edges'), 'expected symbol_edges piece');

console.log('symbol artifacts smoke test passed');
