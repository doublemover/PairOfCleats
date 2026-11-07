import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import { writeIncrementalBundleSnapshot } from '../../../../src/index/build/incremental/bundle-snapshot.js';
import { buildDatabaseFromBundles } from '../../../../src/storage/sqlite/build/from-bundles.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';

export function buildIncrementalChunks({ file, suffix, chunksPerFile }) {
  const chunks = [];
  for (let i = 0; i < chunksPerFile; i += 1) {
    chunks.push({
      file,
      start: i * 10,
      end: i * 10 + 5,
      startLine: i + 1,
      endLine: i + 1,
      kind: 'code',
      name: `fn${suffix}-${i}`,
      tokens: [`tok-${suffix}`, `tok-${i}`]
    });
  }
  return chunks;
}

export async function setupIncrementalBundleDatabase({
  Database,
  name,
  fileCount,
  chunksPerFile
}) {
  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, name);
  const bundleDir = path.join(tempRoot, 'bundles');
  const outPath = path.join(tempRoot, 'index-code.db');

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(bundleDir, { recursive: true });

  const files = Array.from({ length: fileCount }, (_, i) => `src/file-${i}.js`);
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, files: {} };
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const entry = { hash: `hash-${i}`, mtimeMs: 1000 + i, size: 10 + i };
    const snapshot = await writeIncrementalBundleSnapshot({ bundleDir, relKey: file, entry,
      bundles: [{ file, hash: entry.hash, size: entry.size,
        chunks: buildIncrementalChunks({
          file,
          suffix: `v1-${i}`,
          chunksPerFile
        })
      }],
      format: 'json'
    });
    manifest.files[file] = {
      ...entry,
      ...snapshot
    };
  }

  const envConfig = { bundleThreads: 1 };
  const threadLimits = { fileConcurrency: 1 };
  await buildDatabaseFromBundles({
    Database,
    outPath,
    mode: 'code',
    incrementalData: { manifest, bundleDir },
    envConfig,
    threadLimits,
    emitOutput: false,
    validateMode: 'off',
    vectorConfig: { enabled: false },
    modelConfig: { id: null }
  });

  if (!fsSync.existsSync(outPath)) {
    console.error('Expected sqlite DB to be created before incremental update.');
    process.exit(1);
  }

  return { bundleDir, chunksPerFile, files, manifest, outPath };
}

export async function addChangedBundle({
  bundleDir,
  chunksPerFile,
  files,
  manifest,
  changedFileIndex,
  suffix = 'v2'
}) {
  const updatedManifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, files: { ...manifest.files } };
  const changedFile = files[changedFileIndex];
  const entry = { ...updatedManifest.files[changedFile], hash: 'hash-changed', mtimeMs: 9999 };
  const snapshot = await writeIncrementalBundleSnapshot({ bundleDir, relKey: changedFile, entry,
    bundles: [{ file: changedFile, hash: entry.hash, size: entry.size,
      chunks: buildIncrementalChunks({
        file: changedFile,
        suffix,
        chunksPerFile
      })
    }],
    format: 'json'
  });
  updatedManifest.files[changedFile] = {
    ...entry,
    ...snapshot
  };

  return { changedFile, updatedManifest };
}
