#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createCallSites,
  enqueueCallSitesArtifacts
} from '../../../src/index/build/artifacts/writers/call-sites.js';
import { enqueueSymbolsArtifacts } from '../../../src/index/build/artifacts/writers/symbols.js';
import { enqueueSymbolOccurrencesArtifacts } from '../../../src/index/build/artifacts/writers/symbol-occurrences.js';
import { enqueueSymbolEdgesArtifacts } from '../../../src/index/build/artifacts/writers/symbol-edges.js';
import {
  createChunkMetaIterator,
  enqueueChunkMetaArtifacts
} from '../../../src/index/build/artifacts/writers/chunk-meta.js';
import { TRIM_POLICY_VERSION, TRIM_REASONS } from '../../../src/index/build/artifacts/trim-policy.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'trim-policy-contract');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const runQueuedWrites = async (writes) => {
  for (const { job } of writes) {
    await job();
  }
};

const createRecorder = () => {
  const entries = [];
  return {
    entries,
    record: (entry) => entries.push(entry)
  };
};

const readTrimMeta = async (outDir, baseName) => {
  const metaPath = path.join(outDir, `${baseName}.meta.json`);
  const payload = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  return payload?.extensions?.trim || null;
};

const readRowsFromShardedMeta = async (outDir, baseName) => {
  const metaPath = path.join(outDir, `${baseName}.meta.json`);
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  const parts = Array.isArray(meta?.parts) ? meta.parts : [];
  const rows = [];
  for (const part of parts) {
    const relPath = typeof part?.path === 'string' ? part.path : null;
    if (!relPath) continue;
    const absPath = path.join(outDir, relPath);
    const raw = await fs.readFile(absPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      rows.push(JSON.parse(line));
    }
  }
  return rows;
};

const assertTrimMeta = (trim, reason) => {
  assert.ok(trim && typeof trim === 'object', 'expected trim metadata');
  assert.equal(trim.trimPolicyVersion, TRIM_POLICY_VERSION, 'trim policy version mismatch');
  assert.ok(trim.trimmedRows > 0 || trim.droppedRows > 0, 'expected trim counters to increment');
  assert.ok(trim.trimReasonCounts && typeof trim.trimReasonCounts === 'object', 'expected trim reason counts');
  assert.ok((trim.trimReasonCounts[reason] || 0) > 0, `expected trim reason ${reason}`);
};

const runCallSitesCase = async (outDir) => {
  await fs.mkdir(outDir, { recursive: true });
  const chunks = [
    {
      id: 0,
      file: 'src/a.ts',
      chunkUid: 'ck:a',
      lang: 'typescript',
      codeRelations: {
        callDetails: [
          {
            callee: 'beta',
            start: 0,
            end: 10,
            startLine: 1,
            startCol: 1,
            endLine: 1,
            endCol: 11,
            args: ['x'],
            kwargs: { payload: 'x'.repeat(40000) }
          },
          {
            callee: 'gamma',
            start: 12,
            end: 20,
            startLine: 2,
            startCol: 1,
            endLine: 2,
            endCol: 9,
            args: ['y'],
            kwargs: { payload: 'y'.repeat(42000) }
          }
        ]
      }
    }
  ];
  const rows = createCallSites({ chunks });
  const maxLine = Math.max(...rows.map((row) => Buffer.byteLength(JSON.stringify(row), 'utf8') + 1));
  const writes = [];
  const recorder = createRecorder();
  await enqueueCallSitesArtifacts({
    state: { chunks },
    outDir,
    maxJsonBytes: maxLine,
    enqueueWrite: (_label, job) => writes.push({ job }),
    addPieceFile: () => {},
    formatArtifactLabel: (value) => value,
    stageCheckpoints: recorder
  });
  await runQueuedWrites(writes);
  const outRows = await readRowsFromShardedMeta(outDir, 'call_sites');
  const trim = await readTrimMeta(outDir, 'call_sites');
  const telemetry = recorder.entries.find((entry) => entry?.label === 'call_sites');
  return { rows: outRows, trim, telemetry };
};

const runSymbolsCase = async (outDir) => {
  await fs.mkdir(outDir, { recursive: true });
  const chunks = [
    {
      file: 'src/a.ts',
      name: 'Alpha',
      kind: 'function',
      chunkUid: 'ck:a',
      metaV2: {
        file: 'src/a.ts',
        virtualPath: 'src/a.ts',
        chunkUid: 'ck:a',
        symbol: {
          symbolId: 'sym:a',
          scopedId: 'scope:a',
          symbolKey: 'symkey:a',
          qualifiedName: 'Alpha',
          kindGroup: 'function'
        }
      },
      docmeta: { signature: 'sig-a'.repeat(9000) }
    },
    {
      file: 'src/b.ts',
      name: 'Beta',
      kind: 'function',
      chunkUid: 'ck:b',
      metaV2: {
        file: 'src/b.ts',
        virtualPath: 'src/b.ts',
        chunkUid: 'ck:b',
        symbol: {
          symbolId: 'sym:b',
          scopedId: 'scope:b',
          symbolKey: 'symkey:b',
          qualifiedName: 'Beta',
          kindGroup: 'function'
        }
      },
      docmeta: { signature: 'sig-b'.repeat(9000) }
    }
  ];
  const recorder = createRecorder();
  const runWithMaxBytes = async (maxJsonBytes) => {
    const writes = [];
    await enqueueSymbolsArtifacts({
      state: { chunks },
      outDir,
      maxJsonBytes,
      enqueueWrite: (_label, job) => writes.push({ job }),
      addPieceFile: () => {},
      formatArtifactLabel: (value) => value,
      stageCheckpoints: recorder
    });
    await runQueuedWrites(writes);
  };
  await runWithMaxBytes(null);
  const raw = await fs.readFile(path.join(outDir, 'symbols.jsonl'), 'utf8');
  const rawLines = raw.split(/\r?\n/).filter(Boolean);
  const maxLine = rawLines.length
    ? Math.max(...rawLines.map((line) => Buffer.byteLength(line, 'utf8') + 1))
    : 256;
  await runWithMaxBytes(maxLine);
  const outRows = await readRowsFromShardedMeta(outDir, 'symbols');
  const trim = await readTrimMeta(outDir, 'symbols');
  const telemetry = recorder.entries.find((entry) => entry?.label === 'symbols');
  return { rows: outRows, trim, telemetry };
};

const buildHugeRef = (label) => ({
  status: 'resolved',
  targetName: label,
  importHint: `hint:${'x'.repeat(16000)}`,
  resolved: {
    symbolId: `sym:${label}`,
    chunkUid: `ck:${label}`,
    symbolKey: `symkey:${label}`
  },
  candidates: Array.from({ length: 64 }, (_, index) => ({
    symbolId: `sym:${label}:${index}:${'a'.repeat(300)}`,
    chunkUid: `ck:${label}:${index}`,
    symbolKey: `symkey:${label}:${index}`
  }))
});

const buildRelationsChunks = () => ([
  {
    file: 'src/a.ts',
    chunkUid: 'ck:a',
    metaV2: {
      file: 'src/a.ts',
      chunkUid: 'ck:a'
    },
    codeRelations: {
      callDetails: [
        {
          callee: 'beta',
          calleeRef: buildHugeRef('beta'),
          start: 0,
          end: 8
        }
      ],
      callLinks: [
        {
          edgeKind: 'call',
          to: buildHugeRef('gamma')
        }
      ],
      usageLinks: [
        {
          edgeKind: 'usage',
          to: buildHugeRef('delta')
        }
      ]
    }
  },
  {
    file: 'src/b.ts',
    chunkUid: 'ck:b',
    metaV2: {
      file: 'src/b.ts',
      chunkUid: 'ck:b'
    },
    codeRelations: {
      callLinks: [
        {
          edgeKind: 'call',
          to: buildHugeRef('epsilon')
        }
      ]
    }
  }
]);

const runSymbolOccurrencesCase = async (outDir) => {
  await fs.mkdir(outDir, { recursive: true });
  const chunks = buildRelationsChunks();
  const writes = [];
  const recorder = createRecorder();
  await enqueueSymbolOccurrencesArtifacts({
    state: { chunks },
    outDir,
    maxJsonBytes: 4096,
    enqueueWrite: (_label, job) => writes.push({ job }),
    addPieceFile: () => {},
    formatArtifactLabel: (value) => value,
    stageCheckpoints: recorder
  });
  await runQueuedWrites(writes);
  const outRows = await readRowsFromShardedMeta(outDir, 'symbol_occurrences');
  const trim = await readTrimMeta(outDir, 'symbol_occurrences');
  const telemetry = recorder.entries.find((entry) => entry?.label === 'symbol_occurrences');
  return { rows: outRows, trim, telemetry };
};

const runSymbolEdgesCase = async (outDir) => {
  await fs.mkdir(outDir, { recursive: true });
  const chunks = buildRelationsChunks();
  const writes = [];
  const recorder = createRecorder();
  await enqueueSymbolEdgesArtifacts({
    state: { chunks },
    outDir,
    maxJsonBytes: 4096,
    enqueueWrite: (_label, job) => writes.push({ job }),
    addPieceFile: () => {},
    formatArtifactLabel: (value) => value,
    stageCheckpoints: recorder
  });
  await runQueuedWrites(writes);
  const outRows = await readRowsFromShardedMeta(outDir, 'symbol_edges');
  const trim = await readTrimMeta(outDir, 'symbol_edges');
  const telemetry = recorder.entries.find((entry) => entry?.label === 'symbol_edges');
  return { rows: outRows, trim, telemetry };
};

const runChunkMetaCase = async (outDir) => {
  await fs.mkdir(outDir, { recursive: true });
  const chunks = [
    {
      id: 0,
      chunkId: 'c0',
      file: 'src/a.ts',
      ext: '.ts',
      lang: 'typescript',
      start: 0,
      end: 32,
      startLine: 1,
      endLine: 2,
      kind: 'function',
      name: 'alpha',
      metaV2: {
        chunkId: 'c0',
        chunkUid: 'ck:a',
        file: 'src/a.ts',
        virtualPath: 'src/a.ts'
      },
      tokens: Array.from({ length: 22000 }, () => 'token'),
      ngrams: Array.from({ length: 9000 }, () => 'gram'),
      preContext: 'ctx'.repeat(9000),
      postContext: 'ctx'.repeat(9000),
      docmeta: { long: 'x'.repeat(12000) },
      codeRelations: { payload: 'y'.repeat(12000) }
    },
    {
      id: 1,
      chunkId: 'c1',
      file: 'src/b.ts',
      ext: '.ts',
      lang: 'typescript',
      start: 33,
      end: 72,
      startLine: 3,
      endLine: 5,
      kind: 'function',
      name: 'beta',
      metaV2: {
        chunkId: 'c1',
        chunkUid: 'ck:b',
        file: 'src/b.ts',
        virtualPath: 'src/b.ts'
      },
      tokens: Array.from({ length: 22000 }, () => 'token'),
      ngrams: Array.from({ length: 9000 }, () => 'gram'),
      preContext: 'ctx'.repeat(9000),
      postContext: 'ctx'.repeat(9000),
      docmeta: { long: 'x'.repeat(12000) },
      codeRelations: { payload: 'y'.repeat(12000) }
    }
  ];
  const maxJsonBytes = 4096;
  const writes = [];
  const recorder = createRecorder();
  const chunkMetaIterator = createChunkMetaIterator({
    chunks,
    fileIdByPath: new Map([['src/a.ts', 0], ['src/b.ts', 1]]),
    resolvedTokenMode: 'full',
    tokenSampleSize: 64,
    maxJsonBytes
  });
  await enqueueChunkMetaArtifacts({
    outDir,
    mode: 'code',
    chunkMetaIterator,
    chunkMetaPlan: {
      chunkMetaFormat: 'jsonl',
      chunkMetaStreaming: false,
      chunkMetaUseJsonl: true,
      chunkMetaUseShards: true,
      chunkMetaUseColumnar: false,
      chunkMetaBinaryColumnar: false,
      chunkMetaEstimatedJsonlBytes: 8192,
      chunkMetaShardSize: 1,
      chunkMetaCount: chunks.length,
      maxJsonBytes
    },
    maxJsonBytes,
    enqueueJsonArray: () => {
      throw new Error('chunk_meta trim contract expected JSONL path');
    },
    enqueueWrite: (_label, job) => writes.push({ job }),
    addPieceFile: () => {},
    formatArtifactLabel: (value) => value,
    stageCheckpoints: recorder
  });
  await runQueuedWrites(writes);
  const outRows = await readRowsFromShardedMeta(outDir, 'chunk_meta');
  const trim = await readTrimMeta(outDir, 'chunk_meta');
  const telemetry = recorder.entries.find((entry) => entry?.label === 'chunk_meta');
  return { rows: outRows, trim, telemetry };
};

const callSitesA = await runCallSitesCase(path.join(cacheRoot, 'call-sites-a'));
const callSitesB = await runCallSitesCase(path.join(cacheRoot, 'call-sites-b'));
assert.deepEqual(callSitesA.rows, callSitesB.rows, 'call_sites trim output should be deterministic');
assertTrimMeta(callSitesA.trim, TRIM_REASONS.callSitesClearKwargs);
assert.deepEqual(callSitesA.trim.trimReasonCounts, callSitesB.trim.trimReasonCounts, 'call_sites trim reasons must be deterministic');
assert.ok((callSitesA.telemetry?.extra?.trim?.trimReasonCounts?.[TRIM_REASONS.callSitesClearKwargs] || 0) > 0);
for (const row of callSitesA.rows) {
  assert.ok(row.callSiteId && row.file && row.calleeRaw && row.calleeNormalized, 'call_sites required fields missing');
}

const symbolsA = await runSymbolsCase(path.join(cacheRoot, 'symbols-a'));
const symbolsB = await runSymbolsCase(path.join(cacheRoot, 'symbols-b'));
assert.deepEqual(symbolsA.rows, symbolsB.rows, 'symbols trim output should be deterministic');
assertTrimMeta(symbolsA.trim, TRIM_REASONS.symbolsClearSignature);
assert.deepEqual(symbolsA.trim.trimReasonCounts, symbolsB.trim.trimReasonCounts, 'symbols trim reasons must be deterministic');
assert.ok((symbolsA.telemetry?.extra?.trim?.trimReasonCounts?.[TRIM_REASONS.symbolsClearSignature] || 0) > 0);
for (const row of symbolsA.rows) {
  assert.ok(row.symbolId && row.scopedId && row.symbolKey && row.qualifiedName && row.kindGroup, 'symbols required fields missing');
}

const occurrencesA = await runSymbolOccurrencesCase(path.join(cacheRoot, 'occurrences-a'));
const occurrencesB = await runSymbolOccurrencesCase(path.join(cacheRoot, 'occurrences-b'));
assert.deepEqual(occurrencesA.rows, occurrencesB.rows, 'symbol_occurrences trim output should be deterministic');
assertTrimMeta(occurrencesA.trim, TRIM_REASONS.symbolRefTrimCandidates);
assert.deepEqual(occurrencesA.trim.trimReasonCounts, occurrencesB.trim.trimReasonCounts, 'symbol_occurrences trim reasons must be deterministic');
assert.ok((occurrencesA.telemetry?.extra?.trim?.trimReasonCounts?.[TRIM_REASONS.symbolRefTrimCandidates] || 0) > 0);
for (const row of occurrencesA.rows) {
  assert.ok(row?.host?.file && row?.host?.chunkUid && row?.role && row?.ref, 'symbol_occurrences required fields missing');
}

const edgesA = await runSymbolEdgesCase(path.join(cacheRoot, 'edges-a'));
const edgesB = await runSymbolEdgesCase(path.join(cacheRoot, 'edges-b'));
assert.deepEqual(edgesA.rows, edgesB.rows, 'symbol_edges trim output should be deterministic');
assertTrimMeta(edgesA.trim, TRIM_REASONS.symbolRefTrimCandidates);
assert.deepEqual(edgesA.trim.trimReasonCounts, edgesB.trim.trimReasonCounts, 'symbol_edges trim reasons must be deterministic');
assert.ok((edgesA.telemetry?.extra?.trim?.trimReasonCounts?.[TRIM_REASONS.symbolRefTrimCandidates] || 0) > 0);
for (const row of edgesA.rows) {
  assert.ok(row?.from?.file && row?.from?.chunkUid && row?.to && row?.type, 'symbol_edges required fields missing');
}

const chunkMetaA = await runChunkMetaCase(path.join(cacheRoot, 'chunk-meta-a'));
const chunkMetaB = await runChunkMetaCase(path.join(cacheRoot, 'chunk-meta-b'));
assert.deepEqual(chunkMetaA.rows, chunkMetaB.rows, 'chunk_meta trim output should be deterministic');
assertTrimMeta(chunkMetaA.trim, TRIM_REASONS.chunkMetaDropTokenFields);
assert.deepEqual(chunkMetaA.trim.trimReasonCounts, chunkMetaB.trim.trimReasonCounts, 'chunk_meta trim reasons must be deterministic');
assert.ok((chunkMetaA.telemetry?.extra?.trim?.trimReasonCounts?.[TRIM_REASONS.chunkMetaDropTokenFields] || 0) > 0);
for (const row of chunkMetaA.rows) {
  assert.ok(Number.isFinite(row.id), 'chunk_meta id must survive trimming');
  assert.ok(Number.isFinite(row.start), 'chunk_meta start must survive trimming');
  assert.ok(Number.isFinite(row.end), 'chunk_meta end must survive trimming');
}

console.log('trim policy contract test passed');
