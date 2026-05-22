import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { writeBundleFile } from '../../../src/shared/bundle-io.js';
import { setRecordsIncrementalCapability } from '../../../src/storage/sqlite/build/index.js';

export const loadSqliteBenchDatabase = async () => {
  try {
    const { default: Database } = await import('better-sqlite3');
    return Database;
  } catch (err) {
    console.error(`better-sqlite3 missing: ${err?.message || err}`);
    process.exit(1);
  }
};

export const createSqliteBenchWorkspace = async ({ name, sqliteMode = 'code' }) => {
  const tempRoot = path.join(process.cwd(), '.benchCache', name);
  const bundleDir = path.join(tempRoot, 'bundles');
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(bundleDir, { recursive: true });
  return {
    tempRoot,
    bundleDir,
    outPathBaseline: path.join(tempRoot, `index-${sqliteMode}-baseline.db`),
    outPathCurrent: path.join(tempRoot, `index-${sqliteMode}-current.db`)
  };
};

export const resolveSqliteBenchChunkKind = (sqliteMode) => {
  if (sqliteMode === 'records') return 'Record';
  return sqliteMode === 'code' ? 'code' : 'prose';
};

export const createSqliteBenchChunks = ({ file, suffix, chunksPerFile, kind }) => {
  const chunks = [];
  for (let i = 0; i < chunksPerFile; i += 1) {
    chunks.push({
      file,
      start: i * 10,
      end: i * 10 + 5,
      startLine: i + 1,
      endLine: i + 1,
      kind,
      name: `fn${suffix}-${i}`,
      tokens: [`tok-${suffix}`, `tok-${i}`]
    });
  }
  return chunks;
};

export const writeSqliteBenchBundle = async ({ bundleDir, bundleName, chunks }) => {
  await writeBundleFile({
    bundlePath: path.join(bundleDir, bundleName),
    bundle: { chunks },
    format: 'json'
  });
};

export const createSqliteBenchBundleFixture = async ({
  bundleDir,
  fileCount,
  chunksPerFile,
  sqliteMode = 'code'
}) => {
  const manifest = { files: {} };
  if (sqliteMode === 'records') {
    setRecordsIncrementalCapability(manifest, true);
  }
  const chunkKind = resolveSqliteBenchChunkKind(sqliteMode);
  const buildChunks = (file, suffix) => createSqliteBenchChunks({
    file,
    suffix,
    chunksPerFile,
    kind: chunkKind
  });

  for (let i = 0; i < fileCount; i += 1) {
    const file = `src/file-${i}.js`;
    const bundleName = `bundle-${i}.json`;
    await writeSqliteBenchBundle({
      bundleDir,
      bundleName,
      chunks: buildChunks(file, `v1-${i}`)
    });
    manifest.files[file] = {
      hash: `hash-${i}`,
      mtimeMs: 1000 + i,
      size: 10 + i,
      bundle: bundleName
    };
  }

  return { manifest, buildChunks };
};

export const requireSqliteDb = (dbPath, message = 'Expected sqlite DB to be created.') => {
  if (!fsSync.existsSync(dbPath)) {
    console.error(message);
    process.exit(1);
  }
};
