#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { ensureVfsDiskDocument, resolveVfsDiskPath } from '../../../src/index/tooling/vfs.js';
import { ensureVirtualFilesBatch, resolveVfsIoBatching } from '../../../src/integrations/tooling/providers/lsp.js';

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

  const batching = resolveVfsIoBatching({ enabled: true, maxInflight: 2, maxQueueEntries: 2 });
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

  console.log('vfs io batch consistency ok');
} finally {
  await rmDirRecursive(tempRoot);
}
