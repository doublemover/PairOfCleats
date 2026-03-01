#!/usr/bin/env node
// Usage: node tools/bench/vfs/cold-start-cache.js --docs 2000 --doc-bytes 256 --json
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { spawnSubprocessSync } from '../../../src/shared/subprocess.js';
import { formatStats, summarizeDurations, writeJsonWithDir } from '../micro/utils.js';
import { createVfsColdStartCache, ensureVfsDiskDocument } from '../../../src/index/tooling/vfs.js';
import { checksumString } from '../../../src/shared/hash.js';

const rawArgs = process.argv.slice(2);
const cli = createCli({
  scriptName: 'cold-start-cache',
  argv: ['node', 'cold-start-cache', ...rawArgs],
  options: {
    mode: { type: 'string', describe: 'Internal: cold|warm (used by harness)' },
    docs: { type: 'number', default: 2000, describe: 'Document count' },
    docBytes: { type: 'number', default: 256, describe: 'Bytes per document' },
    samples: { type: 'number', default: 3, describe: 'Repeat count for timing stats' },
    root: { type: 'string', describe: 'Internal: shared root for warm run' },
    json: { type: 'boolean', default: false },
    out: { type: 'string', describe: 'Write JSON results to a file' }
  }
});
const argv = cli.parse();

const docCount = clampInt(argv.docs, 1, 2000);
const docBytes = clampInt(argv.docBytes, 8, 256);
const samples = clampInt(argv.samples, 1, 3);

if (argv.mode) {
  const result = await runSingleMode({
    mode: String(argv.mode),
    rootDir: argv.root ? path.resolve(String(argv.root)) : null,
    docs: docCount,
    docBytes,
    samples
  });
  if (argv.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(`[cold-start-cache:${argv.mode}] docs=${docCount} bytes=${docBytes}`);
    console.error(`- ${formatStats(result.stats)} | docs/sec ${result.docsPerSec.toFixed(1)}`);
  }
  process.exit(0);
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-vfs-cold-start-'));
try {
  const cold = runSubprocess({ mode: 'cold', rootDir: tempRoot, docs: docCount, docBytes, samples });
  const warm = runSubprocess({ mode: 'warm', rootDir: tempRoot, docs: docCount, docBytes, samples });

  const results = {
    generatedAt: new Date().toISOString(),
    docs: docCount,
    docBytes,
    samples,
    cold,
    warm
  };

  if (argv.out) {
    writeJsonWithDir(argv.out, results);
  }
  if (argv.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.error(`[cold-start-cache] docs=${docCount} bytes=${docBytes}`);
    console.error(`- cold: ${formatStats(cold.stats)} | docs/sec ${cold.docsPerSec.toFixed(1)}`);
    console.error(`- warm: ${formatStats(warm.stats)} | docs/sec ${warm.docsPerSec.toFixed(1)}`);
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

function clampInt(value, min, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function runSubprocess({ mode, rootDir, docs, docBytes, samples }) {
  const result = spawnSubprocessSync(
    process.execPath,
    [
      path.resolve(process.argv[1]),
      '--mode',
      mode,
      '--root',
      rootDir,
      '--docs',
      String(docs),
      '--doc-bytes',
      String(docBytes),
      '--samples',
      String(samples),
      '--json'
    ],
    {
      outputEncoding: 'utf8',
      captureStdout: true,
      captureStderr: true,
      outputMode: 'string',
      rejectOnNonZeroExit: false,
      killTree: true,
      detached: process.platform !== 'win32'
    }
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `cold-start-cache ${mode} failed`);
  }
  return JSON.parse(result.stdout);
}

async function runSingleMode({ mode, rootDir, docs, docBytes, samples: sampleCount }) {
  const baseDir = path.join(rootDir || process.cwd(), 'vfs');
  const cacheRoot = path.join(rootDir || process.cwd(), 'cache');
  await fs.mkdir(baseDir, { recursive: true });
  await fs.mkdir(cacheRoot, { recursive: true });

  const documents = await buildDocs({ count: docs, bytes: docBytes });
  const indexSignature = 'bench-index-signature';
  const manifestHash = 'xxh64:bench-manifest';
  const cache = await createVfsColdStartCache({
    cacheRoot,
    indexSignature,
    manifestHash,
    config: { enabled: true, cacheRoot }
  });

  const timings = [];
  let totalMs = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const start = process.hrtime.bigint();
    for (const doc of documents) {
      await ensureVfsDiskDocument({
        baseDir,
        virtualPath: doc.virtualPath,
        text: doc.text,
        docHash: doc.docHash,
        coldStartCache: cache
      });
    }
    if (mode === 'cold' && cache?.flush) {
      await cache.flush();
    }
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    timings.push(elapsed);
    totalMs += elapsed;
  }
  const stats = summarizeDurations(timings);
  const docsPerSec = totalMs > 0 ? (docs * sampleCount) / (totalMs / 1000) : 0;
  return { mode, docs, docBytes, samples: sampleCount, stats, totalMs, docsPerSec };
}

async function buildDocs({ count, bytes }) {
  const docs = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const text = `doc-${i}-` + 'x'.repeat(Math.max(0, bytes - 6));
    const hash = await checksumString(text);
    const docHash = hash?.value ? `xxh64:${hash.value}` : 'xxh64:';
    docs[i] = {
      virtualPath: `.poc-vfs/src/doc-${i}.txt`,
      text,
      docHash
    };
  }
  return docs;
}
