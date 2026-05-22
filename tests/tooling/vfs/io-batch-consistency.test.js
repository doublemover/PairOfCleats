#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { ensureVfsDiskDocument, resolveVfsDiskPath } from '../../../src/index/tooling/vfs.js';
import {
  createVfsQueuedWriteBatcher,
  ensureVirtualFilesBatch,
  resolveVfsIoBatching
} from '../../../src/integrations/tooling/providers/lsp.js';

const tempRoot = await makeTempDir('pairofcleats-vfs-io-batch-');
const outDir = path.join(tempRoot, 'vfs');
await fs.mkdir(outDir, { recursive: true });

try {
  const docs = [
    {
      virtualPath: '.poc-vfs/src/a.ts#seg:seg-a.ts',
      text: 'const a = 1;\n',
      docHash: 'xxh64:aaaaaaaaaaaaaaaa'
    },
    {
      virtualPath: '.poc-vfs/src/b.ts#seg:seg-b.ts',
      text: 'const b = 2;\n',
      docHash: 'xxh64:bbbbbbbbbbbbbbbb'
    },
    {
      virtualPath: '.poc-vfs/src/c.ts#seg:seg-c.ts',
      text: 'const c = 3;\n',
      docHash: 'xxh64:cccccccccccccccc'
    }
  ];

  const sequential = new Map();
  for (const doc of docs) {
    const result = await ensureVfsDiskDocument({
      baseDir: outDir,
      virtualPath: doc.virtualPath,
      text: doc.text,
      docHash: doc.docHash
    });
    sequential.set(doc.virtualPath, result.path);
  }

  const batching = resolveVfsIoBatching({
    enabled: true,
    maxInflight: 2,
    maxQueueEntries: 2,
    maxBatchBytes: 32,
    flushIntervalMs: 5,
    writeMode: 'atomic'
  });
  assert.equal(batching.maxBatchBytes, 32, 'Expected maxBatchBytes to be normalized.');
  assert.equal(batching.flushIntervalMs, 5, 'Expected flushIntervalMs to be normalized.');
  assert.equal(batching.writeMode, 'atomic', 'Expected writeMode to be normalized.');
  const batched = await ensureVirtualFilesBatch({
    rootDir: outDir,
    docs,
    batching
  });

  assert.equal(batched.size, docs.length, 'Expected batched write to return all paths.');

  for (const doc of docs) {
    const expectedPath = resolveVfsDiskPath({ baseDir: outDir, virtualPath: doc.virtualPath });
    const seqPath = sequential.get(doc.virtualPath);
    const batchedPath = batched.get(doc.virtualPath);
    assert.equal(seqPath, expectedPath, 'Expected sequential path to be deterministic.');
    assert.equal(batchedPath, expectedPath, 'Expected batched path to be deterministic.');
    const contents = await fs.readFile(batchedPath, 'utf8');
    assert.equal(contents, doc.text, 'Expected batched write contents to match.');
  }

  const rerun = await ensureVirtualFilesBatch({
    rootDir: outDir,
    docs,
    batching
  });
  for (const doc of docs) {
    assert.equal(rerun.get(doc.virtualPath), sequential.get(doc.virtualPath), 'Expected stable path on rerun.');
  }

  const queuedDocs = [
    {
      virtualPath: '.poc-vfs/src/queued.ts#seg:seg-queued.ts',
      text: 'const queued = 1;\n',
      docHash: 'xxh64:1111111111111111'
    },
    {
      virtualPath: '.poc-vfs/src/other.ts#seg:seg-other.ts',
      text: 'const other = 1;\n',
      docHash: 'xxh64:2222222222222222'
    },
    {
      virtualPath: '.poc-vfs/src/queued.ts#seg:seg-queued.ts',
      text: 'const queued = 2;\n',
      docHash: 'xxh64:3333333333333333'
    }
  ];
  const queued = await ensureVirtualFilesBatch({
    rootDir: outDir,
    docs: queuedDocs,
    batching: resolveVfsIoBatching({ enabled: true, maxInflight: 2, maxQueueEntries: 10 })
  });
  assert.equal(queued.size, 2, 'Expected duplicate queued writes to coalesce by final path.');
  const queuedPath = queued.get('.poc-vfs/src/queued.ts#seg:seg-queued.ts');
  assert.equal(
    await fs.readFile(queuedPath, 'utf8'),
    'const queued = 2;\n',
    'Expected last queued write to win.'
  );

  const writer = createVfsQueuedWriteBatcher({
    rootDir: outDir,
    batching: resolveVfsIoBatching({ enabled: true, maxInflight: 1, maxQueueEntries: 4 })
  });
  await writer.enqueue({
    virtualPath: '.poc-vfs/src/manual.ts#seg:seg-manual.ts',
    text: 'manual one\n',
    docHash: 'xxh64:4444444444444444'
  });
  await writer.enqueue({
    virtualPath: '.poc-vfs/src/manual.ts#seg:seg-manual.ts',
    text: 'manual two\n',
    docHash: 'xxh64:5555555555555555'
  });
  assert.equal(writer.getPendingSize(), 1, 'Expected manual writer to coalesce pending duplicate path.');
  const manual = await writer.drain();
  assert.equal(
    await fs.readFile(manual.get('.poc-vfs/src/manual.ts#seg:seg-manual.ts'), 'utf8'),
    'manual two\n',
    'Expected manual queued writer to flush the last write.'
  );

  console.log('vfs io batch consistency ok');
} finally {
  await rmDirRecursive(tempRoot);
}
