import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { validateSqliteMetaV2Parity } from '../../../../src/index/validate/checks.js';
import { writeBundleFile } from '../../../../src/shared/bundle-io.js';
import { buildDatabaseFromBundles } from '../../../../src/storage/sqlite/build/from-bundles.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';

export const loadSqliteBundleDatabase = async (reason = 'sqlite bundle tests') => {
  try {
    const loaded = await import('better-sqlite3');
    return loaded.default;
  } catch {
    console.error(`better-sqlite3 is required for ${reason}.`);
    process.exit(1);
  }
};

export const prepareBundleBuildFixture = async ({ label, dbName }) => {
  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, label);
  const bundleDir = path.join(tempRoot, 'bundles');
  const dbPath = path.join(tempRoot, dbName);

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(bundleDir, { recursive: true });

  return { tempRoot, bundleDir, dbPath };
};

export const writeSingleChunkBundle = async ({ bundleDir, bundleName, file, chunk }) => {
  await writeBundleFile({
    bundlePath: path.join(bundleDir, bundleName),
    format: 'json',
    bundle: {
      file,
      chunks: [chunk]
    }
  });
};

export const createBundleManifest = (entries) => ({
  files: Object.fromEntries(entries.map((entry) => [
    entry.file,
    {
      bundles: entry.bundles,
      mtimeMs: entry.mtimeMs,
      size: entry.size,
      hash: entry.hash
    }
  ]))
});

export const buildBundleDatabase = async ({
  Database,
  dbPath,
  mode,
  manifest,
  bundleDir,
  threadLimits = { fileConcurrency: 1 }
}) => buildDatabaseFromBundles({
  Database,
  outPath: dbPath,
  mode,
  incrementalData: { manifest, bundleDir },
  envConfig: { bundleThreads: 1 },
  threadLimits,
  emitOutput: false,
  validateMode: 'off',
  vectorConfig: { enabled: false },
  modelConfig: { id: null },
  workerPath: null
});

export const readBundleRows = ({ Database, dbPath, mode }) => {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare('SELECT id, chunk_id, metaV2_json FROM chunks WHERE mode = ? ORDER BY id')
      .all(mode);
  } finally {
    db.close();
  }
};

export const assertMetaV2Parity = ({ mode, chunkMeta, rows }) => {
  const report = { issues: [], warnings: [], hints: [] };
  validateSqliteMetaV2Parity(report, mode, chunkMeta, rows, { maxErrors: 10 });
  assert.equal(report.issues.length, 0, `expected no sqlite metaV2 parity issues: ${report.issues.join(', ')}`);
};
