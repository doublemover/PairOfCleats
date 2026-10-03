import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import { writeBundleFile } from '../../../../src/shared/bundle-io.js';
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
  const manifest = { files: {} };
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const bundleName = `bundle-${i}.json`;
    await writeBundleFile({
      bundlePath: path.join(bundleDir, bundleName),
      bundle: {
        chunks: buildIncrementalChunks({
          file,
          suffix: `v1-${i}`,
          chunksPerFile
        })
      },
      format: 'json'
    });
    manifest.files[file] = {
      hash: `hash-${i}`,
      mtimeMs: 1000 + i,
      size: 10 + i,
      bundles: [bundleName]
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
  changedBundleName = 'bundle-changed.json',
  suffix = 'v2'
}) {
  const updatedManifest = { files: { ...manifest.files } };
  const changedFile = files[changedFileIndex];
  await writeBundleFile({
    bundlePath: path.join(bundleDir, changedBundleName),
    bundle: {
      chunks: buildIncrementalChunks({
        file: changedFile,
        suffix,
        chunksPerFile
      })
    },
    format: 'json'
  });
  updatedManifest.files[changedFile] = {
    ...updatedManifest.files[changedFile],
    hash: 'hash-changed',
    mtimeMs: 9999,
    bundles: [changedBundleName]
  };

  return { changedFile, updatedManifest };
}
