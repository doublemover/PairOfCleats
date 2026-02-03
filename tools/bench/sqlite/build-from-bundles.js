#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeBundleFile } from '../../../src/shared/bundle-io.js';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';

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
const fileCount = Number(args.files) || 20;
const chunksPerFile = Number(args.chunks) || 6;

const tempRoot = path.join(process.cwd(), '.benchCache', 'sqlite-build-from-bundles');
const bundleDir = path.join(tempRoot, 'bundles');
const outPath = path.join(tempRoot, 'index-code.db');

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
const stats = {};
const start = performance.now();
const result = await buildDatabaseFromBundles({
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
  stats
});
const durationMs = performance.now() - start;

if (!fsSync.existsSync(outPath)) {
  console.error('Expected sqlite DB to be created.');
  process.exit(1);
}

console.log(`[bench] build-from-bundles files=${fileCount} chunks=${result.count} ms=${durationMs.toFixed(1)}`);
if (stats.pragmas) {
  console.log('[bench] pragmas', stats.pragmas);
}
if (stats.tables) {
  console.log('[bench] tables', stats.tables);
}
