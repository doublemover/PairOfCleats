#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { enqueueCallSitesArtifacts } from '../../src/index/build/artifacts/writers/call-sites.js';
import { enqueueSymbolsArtifacts } from '../../src/index/build/artifacts/writers/symbols.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'writer-unified-pipeline');
const callSitesDir = path.join(tempRoot, 'call-sites');
const symbolsDir = path.join(tempRoot, 'symbols');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(callSitesDir, { recursive: true });
await fsPromises.mkdir(symbolsDir, { recursive: true });

const chunk = {
  id: 1,
  file: 'src/a.js',
  chunkUid: 'chunk-1',
  lang: 'javascript',
  metaV2: {
    file: 'src/a.js',
    chunkUid: 'chunk-1',
    virtualPath: 'src/a.js',
    lang: 'javascript',
    symbol: {
      symbolId: 'sym-1',
      scopedId: 'scoped-1',
      symbolKey: 'symkey-1',
      qualifiedName: 'pkg.fn',
      kindGroup: 'function'
    }
  },
  codeRelations: {
    callDetails: [
      {
        calleeRaw: 'x'.repeat(500),
        start: 0,
        end: 10,
        startLine: 1,
        startCol: 1,
        endLine: 1,
        endCol: 11
      }
    ]
  }
};

const state = { chunks: [chunk] };

const expectThrow = async (label, fn) => {
  try {
    await fn();
  } catch {
    return;
  }
  console.error(`writer unified pipeline test failed: expected error for ${label}.`);
  process.exit(1);
};

await expectThrow('call_sites maxJsonBytes guard', async () => {
  enqueueCallSitesArtifacts({
    state,
    outDir: callSitesDir,
    maxJsonBytes: 200,
    compression: null,
    enqueueWrite: () => {},
    addPieceFile: () => {},
    formatArtifactLabel: (value) => value
  });
});

const runEnqueuedWrites = async (label, enqueue) => {
  const writes = [];
  const enqueueWrite = (_label, fn) => {
    writes.push(fn());
  };
  await enqueue({ enqueueWrite });
  try {
    await Promise.all(writes);
  } catch (err) {
    console.error(`writer unified pipeline test failed: ${label} write failed.`, err);
    process.exit(1);
  }
};

await runEnqueuedWrites('call_sites', async ({ enqueueWrite }) => {
  enqueueCallSitesArtifacts({
    state,
    outDir: callSitesDir,
    maxJsonBytes: 1024 * 1024,
    compression: null,
    enqueueWrite,
    addPieceFile: () => {},
    formatArtifactLabel: (value) => value
  });
});

const callSitesPath = path.join(callSitesDir, 'call_sites.jsonl');
const callSitesOffsets = `${callSitesPath}.offsets.bin`;
if (!fs.existsSync(callSitesPath)) {
  console.error('writer unified pipeline test failed: call_sites.jsonl was not written.');
  process.exit(1);
}
if (!fs.existsSync(callSitesOffsets)) {
  console.error('writer unified pipeline test failed: call_sites offsets not written.');
  process.exit(1);
}

await runEnqueuedWrites('symbols', async ({ enqueueWrite }) => {
  await enqueueSymbolsArtifacts({
    state,
    outDir: symbolsDir,
    maxJsonBytes: 1024 * 1024,
    compression: null,
    enqueueWrite,
    addPieceFile: () => {},
    formatArtifactLabel: (value) => value
  });
});

const symbolsPath = path.join(symbolsDir, 'symbols.jsonl');
const symbolsOffsets = `${symbolsPath}.offsets.bin`;
if (!fs.existsSync(symbolsPath)) {
  console.error('writer unified pipeline test failed: symbols.jsonl was not written.');
  process.exit(1);
}
if (!fs.existsSync(symbolsOffsets)) {
  console.error('writer unified pipeline test failed: symbols offsets not written.');
  process.exit(1);
}

console.log('writer unified pipeline tests passed');
