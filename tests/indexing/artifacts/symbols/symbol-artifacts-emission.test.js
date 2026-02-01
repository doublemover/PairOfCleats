#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { enqueueSymbolsArtifacts } from '../../../../src/index/build/artifacts/writers/symbols.js';
import { enqueueSymbolOccurrencesArtifacts } from '../../../../src/index/build/artifacts/writers/symbol-occurrences.js';
import { enqueueSymbolEdgesArtifacts } from '../../../../src/index/build/artifacts/writers/symbol-edges.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'symbol-artifacts-emission');
const rawDir = path.join(tempRoot, 'raw');
const shardDir = path.join(tempRoot, 'sharded');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(rawDir, { recursive: true });
await fs.mkdir(shardDir, { recursive: true });

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
        },
        {
          v: 1,
          edgeKind: 'call',
          fromChunkUid: 'uid-alpha',
          to: makeRef('gamma', 'uid-gamma')
        }
      ],
      callDetails: [
        {
          callee: 'beta',
          calleeRef: makeRef('beta', 'uid-beta'),
          start: 0,
          end: 4
        },
        {
          callee: 'gamma',
          calleeRef: makeRef('gamma', 'uid-gamma'),
          start: 5,
          end: 9
        }
      ],
      usageLinks: [
        {
          v: 1,
          edgeKind: 'usage',
          fromChunkUid: 'uid-alpha',
          to: makeRef('beta', 'uid-beta')
        },
        {
          v: 1,
          edgeKind: 'usage',
          fromChunkUid: 'uid-alpha',
          to: makeRef('gamma', 'uid-gamma')
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
  },
  {
    file: 'src/gamma.js',
    name: 'gamma',
    kind: 'function',
    chunkUid: 'uid-gamma',
    metaV2: {
      file: 'src/gamma.js',
      virtualPath: 'src/gamma.js',
      chunkUid: 'uid-gamma',
      symbol: makeSymbol('gamma', 'uid-gamma', 'src/gamma.js')
    }
  }
];

const runWriters = async (outDir, maxJsonBytes) => {
  const writes = [];
  const pieceEntries = [];
  const enqueueWrite = (label, job) => writes.push({ label, job });
  const addPieceFile = (entry, filePath) => pieceEntries.push({ entry, filePath });
  const formatArtifactLabel = (value) => value;

  await enqueueSymbolsArtifacts({
    state: { chunks },
    outDir,
    maxJsonBytes,
    compression: null,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });
  await enqueueSymbolOccurrencesArtifacts({
    state: { chunks },
    outDir,
    maxJsonBytes,
    compression: null,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });
  await enqueueSymbolEdgesArtifacts({
    state: { chunks },
    outDir,
    maxJsonBytes,
    compression: null,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });

  for (const { job } of writes) {
    await job();
  }

  return { pieceEntries };
};

const readMaxLineBytes = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return 0;
  return Math.max(...lines.map((line) => Buffer.byteLength(line, 'utf8') + 1));
};

await runWriters(rawDir, null);

const maxLineBytes = Math.max(
  await readMaxLineBytes(path.join(rawDir, 'symbols.jsonl')),
  await readMaxLineBytes(path.join(rawDir, 'symbol_occurrences.jsonl')),
  await readMaxLineBytes(path.join(rawDir, 'symbol_edges.jsonl'))
);

const { pieceEntries } = await runWriters(shardDir, maxLineBytes);
const names = new Set(pieceEntries.map((piece) => piece.entry?.name));
assert.ok(names.has('symbols_meta'), 'expected symbols_meta piece for sharded output');
assert.ok(names.has('symbol_occurrences_meta'), 'expected symbol_occurrences_meta piece for sharded output');
assert.ok(names.has('symbol_edges_meta'), 'expected symbol_edges_meta piece for sharded output');

const expectMeta = async (name) => {
  const metaPath = path.join(shardDir, `${name}.meta.json`);
  const payload = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  assert.ok(Array.isArray(payload?.parts) && payload.parts.length > 0, `expected ${name} parts metadata`);
};

await expectMeta('symbols');
await expectMeta('symbol_occurrences');
await expectMeta('symbol_edges');

console.log('symbol artifacts emission test passed');
