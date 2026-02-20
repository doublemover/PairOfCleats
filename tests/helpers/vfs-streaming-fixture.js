import fs from 'node:fs/promises';
import path from 'node:path';

import { loadJsonArrayArtifact } from '../../src/shared/artifact-io.js';
import {
  buildVfsManifestRowsForFile,
  compareVfsManifestRows
} from '../../src/index/tooling/vfs.js';
import { enqueueVfsManifestArtifacts } from '../../src/index/build/artifacts/writers/vfs-manifest.js';
import { createVfsManifestCollector } from '../../src/index/build/vfs-manifest-collector.js';
import { makeTempDir, rmDirRecursive } from './temp.js';
import { applyTestEnv } from './test-env.js';
import { writePiecesManifest } from './artifact-io-fixture.js';

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
  if (pieceFiles.length) {
    const pieces = pieceFiles.map(({ entry, absPath }) => ({
      ...entry,
      path: path.relative(outDir, absPath).replace(/\\/g, '/')
    }));
    await writePiecesManifest(outDir, pieces);
  }
};

export const createVfsStreamingFixture = async ({ tempPrefix }) => {
  applyTestEnv();

  const tempRoot = await makeTempDir(tempPrefix);
  const outDir = path.join(tempRoot, 'out');
  await fs.mkdir(outDir, { recursive: true });

  const fileText = 'console.log(1);\n';
  const rowsA = await buildVfsManifestRowsForFile({
    chunks: [
      {
        file: 'b.md',
        lang: 'javascript',
        segment: {
          segmentUid: 'segu:v1:b',
          segmentId: 'seg-b',
          start: 0,
          end: fileText.length,
          languageId: 'javascript',
          ext: null
        },
        start: 0,
        end: fileText.length
      }
    ],
    fileText,
    containerPath: 'b.md',
    containerExt: '.md',
    containerLanguageId: 'markdown'
  });

  const rowsB = await buildVfsManifestRowsForFile({
    chunks: [
      {
        file: 'a.md',
        lang: 'javascript',
        segment: {
          segmentUid: 'segu:v1:a',
          segmentId: 'seg-a',
          start: 0,
          end: fileText.length,
          languageId: 'javascript',
          ext: null
        },
        start: 0,
        end: fileText.length
      }
    ],
    fileText,
    containerPath: 'a.md',
    containerExt: '.md',
    containerLanguageId: 'markdown'
  });

  const inputRows = [...rowsA, ...rowsB].reverse();
  const expected = [...rowsA, ...rowsB].sort(compareVfsManifestRows);
  const collector = createVfsManifestCollector({
    buildRoot: tempRoot,
    maxBufferBytes: 16,
    maxBufferRows: 1
  });
  await collector.appendRows(inputRows);

  const jsonlLineBytes = expected.map((row) => Buffer.byteLength(`${JSON.stringify(row)}\n`));
  const maxLineBytes = Math.max(...jsonlLineBytes);
  const totalBytes = jsonlLineBytes.reduce((sum, bytes) => sum + bytes, 0);

  const writeAndLoad = async () => {
    await runWriter({
      outDir,
      mode: 'code',
      rows: collector,
      maxJsonBytes: maxLineBytes + 1
    });
    return loadJsonArrayArtifact(outDir, 'vfs_manifest', { strict: false });
  };

  const cleanup = () => rmDirRecursive(tempRoot);

  return {
    tempRoot,
    outDir,
    collector,
    expected,
    maxLineBytes,
    totalBytes,
    writeAndLoad,
    cleanup
  };
};
