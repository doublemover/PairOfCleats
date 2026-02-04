#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeBundleFile } from '../../../src/shared/bundle-io.js';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';
import { incrementalUpdateDatabase } from '../../../src/storage/sqlite/build/incremental-update.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const parseArgs = () => {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
};

const args = parseArgs();
const fileCount = Number(args.files) || 12;
const chunksPerFile = Number(args.chunks) || 6;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const tempRoot = path.join(process.cwd(), '.benchCache', 'sqlite-incremental-update');
const bundleDir = path.join(tempRoot, 'bundles');
const outPathBaseline = path.join(tempRoot, 'index-code-baseline.db');
const outPathCurrent = path.join(tempRoot, 'index-code-current.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });

const manifest = { files: {} };
const buildChunks = (file, suffix) => {
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
};

for (let i = 0; i < fileCount; i += 1) {
  const file = `src/file-${i}.js`;
  const bundleName = `bundle-${i}.json`;
  await writeBundleFile({
    bundlePath: path.join(bundleDir, bundleName),
    bundle: { chunks: buildChunks(file, `v1-${i}`) },
    format: 'json'
  });
  manifest.files[file] = {
    hash: `hash-${i}`,
    mtimeMs: 1000 + i,
    size: 10 + i,
    bundle: bundleName
  };
}

const envConfig = { bundleThreads: 1 };
const threadLimits = { fileConcurrency: 1 };

const updatedManifest = { files: { ...manifest.files } };
const changedFile = `src/file-${Math.min(2, fileCount - 1)}.js`;
const changedBundleName = 'bundle-changed.json';
await writeBundleFile({
  bundlePath: path.join(bundleDir, changedBundleName),
  bundle: { chunks: buildChunks(changedFile, 'v2') },
  format: 'json'
});
updatedManifest.files[changedFile] = {
  ...updatedManifest.files[changedFile],
  hash: 'hash-changed',
  mtimeMs: 9999,
  bundle: changedBundleName
};

const runUpdate = async ({ label, outPath, buildPragmas, optimize }) => {
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
    modelConfig: { id: null },
    buildPragmas,
    optimize
  });

  if (!fsSync.existsSync(outPath)) {
    console.error('Expected sqlite DB to be created before incremental update.');
    process.exit(1);
  }

  const stats = {};
  const start = performance.now();
  const updateResult = await incrementalUpdateDatabase({
    Database,
    outPath,
    mode: 'code',
    incrementalData: { manifest: updatedManifest, bundleDir },
    modelConfig: { id: null },
    vectorConfig: { enabled: false },
    emitOutput: false,
    validateMode: 'off',
    buildPragmas,
    stats
  });
  const durationMs = performance.now() - start;

  if (!updateResult.used) {
    console.error(`Incremental update skipped: ${updateResult.reason || 'unknown reason'}`);
    process.exit(1);
  }

  console.log(`[bench] incremental-update ${label} files=${fileCount} chunks=${updateResult.insertedChunks} ms=${durationMs.toFixed(1)}`);
  if (stats.tables) {
    console.log(`[bench] ${label} tables`, stats.tables);
  }
  return { durationMs, insertedChunks: updateResult.insertedChunks };
};

let baselineResult = null;
let currentResult = null;
if (mode !== 'current') {
  baselineResult = await runUpdate({
    label: 'baseline',
    outPath: outPathBaseline,
    buildPragmas: false,
    optimize: false
  });
}
if (mode !== 'baseline') {
  currentResult = await runUpdate({
    label: 'current',
    outPath: outPathCurrent,
    buildPragmas: true,
    optimize: true
  });
}
if (baselineResult && currentResult) {
  const deltaMs = currentResult.durationMs - baselineResult.durationMs;
  const deltaPct = baselineResult.durationMs > 0
    ? (deltaMs / baselineResult.durationMs) * 100
    : null;
  console.log(`[bench] delta ms=${deltaMs.toFixed(1)} (${deltaPct?.toFixed(1)}%)`);
}
