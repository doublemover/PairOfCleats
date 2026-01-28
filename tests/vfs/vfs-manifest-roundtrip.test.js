#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ARTIFACT_SCHEMA_DEFS } from '../../src/contracts/registry.js';
import { loadJsonArrayArtifact } from '../../src/shared/artifact-io.js';
import { checksumString } from '../../src/shared/hash.js';
import {
  buildVfsManifestRowsForFile,
  buildVfsVirtualPath
} from '../../src/index/tooling/vfs.js';
import { enqueueVfsManifestArtifacts } from '../../src/index/build/artifacts/writers/vfs-manifest.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';

assert.ok(
  ARTIFACT_SCHEMA_DEFS && typeof ARTIFACT_SCHEMA_DEFS === 'object' && ARTIFACT_SCHEMA_DEFS.vfs_manifest,
  'Expected contracts registry to include a vfs_manifest schema.'
);

const runWriter = async ({ outDir, mode, rows, maxJsonBytes }) => {
  const writes = [];
  const pieceFiles = [];
  const enqueueWrite = (label, fn) => {
    writes.push({ label, fn });
  };
  const addPieceFile = (entry, absPath) => {
    pieceFiles.push({ entry, absPath });
  };
  const formatArtifactLabel = (value) => value;

  await enqueueVfsManifestArtifacts({
    outDir,
    mode,
    rows,
    maxJsonBytes,
    compression: null,
    gzipOptions: null,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });

  for (const write of writes) {
    await write.fn();
  }

  return { pieceFiles };
};

const tempRoot = await makeTempDir('pairofcleats-vfs-manifest-');
const plainDir = path.join(tempRoot, 'plain');
const shardedDir = path.join(tempRoot, 'sharded');
await fs.mkdir(plainDir, { recursive: true });
await fs.mkdir(shardedDir, { recursive: true });

try {
  const containerPath = 'docs/hello%world#v2.md';
  const containerExt = '.md';
  const containerLanguageId = 'markdown';
  const fileText = 'console.log(1);\nconsole.log(2);\n';

  const firstLineEnd = fileText.indexOf('\n') + 1;
  const segmentA = {
    segmentUid: 'segu:v1:seg-a',
    segmentId: 'seg-a',
    start: 0,
    end: firstLineEnd,
    languageId: 'javascript',
    ext: null
  };
  const segmentB = {
    segmentUid: 'segu:v1:seg-b',
    segmentId: 'seg-b',
    start: firstLineEnd,
    end: fileText.length,
    languageId: 'javascript',
    ext: null
  };

  const chunks = [
    {
      file: containerPath,
      lang: 'javascript',
      segment: segmentA,
      start: segmentA.start,
      end: segmentA.end
    },
    {
      file: containerPath,
      lang: 'javascript',
      segment: segmentB,
      start: segmentB.start,
      end: segmentB.end
    }
  ];

  const rows = await buildVfsManifestRowsForFile({
    chunks,
    fileText,
    containerPath,
    containerExt,
    containerLanguageId
  });

  assert.equal(rows.length, 2, 'Expected one vfs_manifest row per distinct segmentUid.');

  for (const row of rows) {
    const expectedVirtualPath = buildVfsVirtualPath({
      containerPath,
      segmentUid: row.segmentUid,
      effectiveExt: row.effectiveExt
    });
    assert.equal(row.virtualPath, expectedVirtualPath, 'virtualPath should be a deterministic function of containerPath+segmentUid+effectiveExt');

    const segmentText = fileText.slice(row.segmentStart, row.segmentEnd);
    const hash = await checksumString(segmentText);
    const expectedDocHash = hash?.value ? `xxh64:${hash.value}` : 'xxh64:';
    assert.equal(row.docHash, expectedDocHash, 'docHash should roundtrip from the referenced segment text');

    assert.equal(row.containerPath, containerPath);
    assert.equal(row.containerExt, containerExt);
    assert.equal(row.containerLanguageId, containerLanguageId);
    assert.equal(row.languageId, 'javascript');
    assert.equal(row.effectiveExt, '.js', 'effectiveExt should follow language-id extension mapping for embedded segments');
  }

  // Unsharded write/read.
  await runWriter({ outDir: plainDir, mode: 'code', rows, maxJsonBytes: 1024 * 1024 });
  const plainLoaded = await loadJsonArrayArtifact(plainDir, 'vfs_manifest', { strict: false });
  assert.deepStrictEqual(plainLoaded, rows, 'Unsharded vfs_manifest should roundtrip identically.');

  // Force sharded write/read by setting maxJsonBytes to just above the largest JSONL line.
  const jsonlLineBytes = rows.map((row) => Buffer.byteLength(`${JSON.stringify(row)}\n`));
  const maxLineBytes = Math.max(...jsonlLineBytes);
  const totalBytes = jsonlLineBytes.reduce((sum, bytes) => sum + bytes, 0);
  assert.ok(totalBytes > maxLineBytes + 1, 'Fixture should be large enough to force sharding.');

  await runWriter({ outDir: shardedDir, mode: 'code', rows, maxJsonBytes: maxLineBytes + 1 });
  const shardedLoaded = await loadJsonArrayArtifact(shardedDir, 'vfs_manifest', { strict: false });
  assert.deepStrictEqual(shardedLoaded, rows, 'Sharded vfs_manifest should roundtrip identically.');

  await fs.stat(path.join(shardedDir, 'vfs_manifest.meta.json'));
  await fs.stat(path.join(shardedDir, 'vfs_manifest.parts'));

  console.log('VFS manifest roundtrip ok');
} finally {
  await rmDirRecursive(tempRoot);
}
