#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../../../src/shared/hash.js';
import { createTreeSitterSchedulerLookup } from '../../../src/index/build/tree-sitter-scheduler/lookup.js';
import { resolveTreeSitterSchedulerPaths } from '../../../src/index/build/tree-sitter-scheduler/paths.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'scheduler-lookup-reader-lease', 'index-code');
await fs.rm(outDir, { recursive: true, force: true });
const paths = resolveTreeSitterSchedulerPaths(outDir);
await fs.mkdir(paths.resultsDir, { recursive: true });

const createRow = ({ virtualPath, grammarKey, languageId, ext }) => ({
  schemaVersion: '1.1.0',
  virtualPath,
  grammarKey,
  segmentRef: 0,
  chunks: [
    {
      start: 0,
      end: 8,
      name: `fn_${languageId}`,
      kind: 'FunctionDeclaration'
    }
  ],
  containerPath: `src/${languageId}${ext}`,
  languageId,
  effectiveExt: ext
});

const writeBinaryRow = async ({ grammarKey, row }) => {
  const rowJson = JSON.stringify(row);
  const payload = Buffer.from(rowJson, 'utf8');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(payload.length, 0);
  const rowBytes = payload.length + 4;
  await fs.writeFile(
    paths.resultsPathForGrammarKey(grammarKey, 'binary-v1'),
    Buffer.concat([header, payload])
  );
  await fs.writeFile(
    paths.resultsIndexPathForGrammarKey(grammarKey),
    `${JSON.stringify({
      schemaVersion: '1.0.0',
      virtualPath: row.virtualPath,
      grammarKey,
      offset: 0,
      bytes: rowBytes,
      format: 'binary-v1',
      checksum: sha1(rowJson).slice(0, 16)
    })}\n`,
    'utf8'
  );
  return {
    schemaVersion: '1.0.0',
    virtualPath: row.virtualPath,
    grammarKey,
    offset: 0,
    bytes: rowBytes,
    format: 'binary-v1',
    checksum: sha1(rowJson).slice(0, 16)
  };
};

const grammarA = 'native:javascript';
const grammarB = 'native:typescript';
const rowA = createRow({
  virtualPath: '.poc-vfs/src/a.js#seg:a.js',
  grammarKey: grammarA,
  languageId: 'javascript',
  ext: '.js'
});
const rowB = createRow({
  virtualPath: '.poc-vfs/src/b.ts#seg:b.ts',
  grammarKey: grammarB,
  languageId: 'typescript',
  ext: '.ts'
});
const entryA = await writeBinaryRow({ grammarKey: grammarA, row: rowA });
const entryB = await writeBinaryRow({ grammarKey: grammarB, row: rowB });

const index = new Map();
index.set(rowA.virtualPath, entryA);
index.set(rowB.virtualPath, entryB);

const resultsPathA = paths.resultsPathForGrammarKey(grammarA, 'binary-v1');
const resultsPathB = paths.resultsPathForGrammarKey(grammarB, 'binary-v1');

const originalOpen = fs.open;
try {
  // Regression: overlapping reads with maxOpenReaders=1 must not close an
  // in-use reader and surface "file closed".
  fs.open = async (...args) => {
    const [targetPath] = args;
    const handle = await originalOpen(...args);
    const wrappedRead = handle.read.bind(handle);
    const shouldDelay = String(targetPath) === String(resultsPathA)
      || String(targetPath) === String(resultsPathB);
    return new Proxy(handle, {
      get(target, prop, receiver) {
        if (prop === 'read' && shouldDelay) {
          return async (...readArgs) => {
            await sleep(75);
            return wrappedRead(...readArgs);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };
  const lookup = createTreeSitterSchedulerLookup({
    outDir,
    index,
    maxOpenReaders: 1
  });
  try {
    const defaults = lookup.stats();
    assert.equal(defaults.closeTimeoutMs, 30000, 'expected scheduler lookup close timeout to default to 30s');
    assert.equal(defaults.forceCloseAfterMs, 5000, 'expected scheduler lookup force-close fallback to default to 5s');
    const pendingA = lookup.loadRow(rowA.virtualPath);
    await sleep(10);
    const pendingB = lookup.loadRow(rowB.virtualPath);
    const [loadedA, loadedB] = await Promise.all([pendingA, pendingB]);
    assert.equal(loadedA?.virtualPath, rowA.virtualPath, 'expected overlapping lookup A to succeed');
    assert.equal(loadedB?.virtualPath, rowB.virtualPath, 'expected overlapping lookup B to succeed');
    const stats = lookup.stats();
    assert.ok(stats.readerEvictions >= 1, 'expected reader-cap eviction after overlapping lookups');
    assert.ok(stats.openReaders <= 1, 'expected lookup to respect maxOpenReaders cap');
  } finally {
    await lookup.close();
  }

  // Regression: treat EBADF/"file closed" as transient for scheduler row reads.
  let injectedEbadf = 0;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    const wrappedRead = handle.read.bind(handle);
    let threwOnce = false;
    return new Proxy(handle, {
      get(target, prop, receiver) {
        if (prop === 'read') {
          return async (...readArgs) => {
            if (!threwOnce) {
              threwOnce = true;
              injectedEbadf += 1;
              const err = new Error('file closed');
              err.code = 'EBADF';
              throw err;
            }
            return wrappedRead(...readArgs);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };
  const retryLookup = createTreeSitterSchedulerLookup({ outDir, index });
  try {
    const loaded = await retryLookup.loadRow(rowA.virtualPath);
    assert.equal(loaded?.virtualPath, rowA.virtualPath, 'expected lookup to recover from transient EBADF/file closed');
    assert.ok(
      Number(retryLookup.stats().transientFdRetries || 0) >= 1,
      'expected transient fd retry counter to increment'
    );
  } finally {
    await retryLookup.close();
  }
  await assert.rejects(
    () => retryLookup.loadRow(rowA.virtualPath),
    (err) => err?.code === 'ERR_TREE_SITTER_LOOKUP_CLOSED',
    'expected lookup to reject new reads after close()'
  );
  assert.ok(injectedEbadf >= 1, 'expected injected EBADF/file closed path to be exercised');

  // Regression: a wedged reader close should not stall scheduler lookup close.
  fs.open = async (...args) => {
    const [targetPath] = args;
    const handle = await originalOpen(...args);
    const shouldHangClose = String(targetPath) === String(resultsPathA);
    return new Proxy(handle, {
      get(target, prop, receiver) {
        if (prop === 'close' && shouldHangClose) {
          return async () => new Promise(() => {});
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };
  const hangingCloseLookup = createTreeSitterSchedulerLookup({
    outDir,
    index: new Map([[rowA.virtualPath, entryA]]),
    closeTimeoutMs: 25,
    forceCloseAfterMs: 25
  });
  try {
    const loaded = await hangingCloseLookup.loadRow(rowA.virtualPath);
    assert.equal(loaded?.virtualPath, rowA.virtualPath, 'expected lookup row load before close-timeout regression check');
    const closeStartAtMs = Date.now();
    await hangingCloseLookup.close();
    const closeElapsedMs = Date.now() - closeStartAtMs;
    assert.ok(closeElapsedMs < 1500, `expected lookup close to remain bounded (elapsed=${closeElapsedMs}ms)`);
  } finally {
    await hangingCloseLookup.close();
  }

  // Regression: non-positive force-close config must still stay bounded.
  const nonPositiveForceCloseLookup = createTreeSitterSchedulerLookup({
    outDir,
    index: new Map([[rowA.virtualPath, entryA]]),
    closeTimeoutMs: 25,
    forceCloseAfterMs: 0
  });
  try {
    const loaded = await nonPositiveForceCloseLookup.loadRow(rowA.virtualPath);
    assert.equal(loaded?.virtualPath, rowA.virtualPath, 'expected lookup row load before force-close fallback check');
    const statsBeforeClose = nonPositiveForceCloseLookup.stats();
    assert.ok(
      statsBeforeClose.forceCloseAfterMs >= 5000,
      `expected fallback force-close budget for non-positive config (actual=${statsBeforeClose.forceCloseAfterMs})`
    );
    const closeStartAtMs = Date.now();
    await nonPositiveForceCloseLookup.close();
    const closeElapsedMs = Date.now() - closeStartAtMs;
    assert.ok(closeElapsedMs < 1500, `expected bounded close for non-positive force-close config (elapsed=${closeElapsedMs}ms)`);
  } finally {
    await nonPositiveForceCloseLookup.close();
  }
} finally {
  fs.open = originalOpen;
}

console.log('scheduler lookup reader lease test passed');
