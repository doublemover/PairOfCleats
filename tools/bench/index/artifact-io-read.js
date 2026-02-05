#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonLinesSharded, writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { toPosix } from '../../../src/shared/files.js';

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
const rows = Number(args.rows) || 200000;
const maxBytes = Number(args.maxBytes) || 256 * 1024;
const iterations = Number(args.iterations) || 3;
const baselineConcurrency = Number(args.baselineConcurrency) || 1;
const currentConcurrency = Number(args.currentConcurrency) || 4;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const benchRoot = path.join(process.cwd(), '.benchCache', 'artifact-io-read');
const indexDir = path.join(benchRoot, 'index');
const partsDirName = 'chunk_meta.parts';
const partPrefix = 'chunk_meta.part-';

await fs.rm(benchRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const buildRows = function* buildRows() {
  for (let i = 0; i < rows; i += 1) {
    yield {
      id: i,
      file: `src/file-${i % 200}.js`,
      start: 0,
      end: 1,
      kind: 'code'
    };
  }
};

const shard = await writeJsonLinesSharded({
  dir: indexDir,
  partsDirName,
  partPrefix,
  items: buildRows(),
  maxBytes,
  atomic: true
});

await writeJsonObjectFile(path.join(indexDir, 'chunk_meta.meta.json'), {
  fields: {
    schemaVersion: '0.0.1',
    artifact: 'chunk_meta',
    format: 'jsonl-sharded',
    compression: 'none',
    totalRecords: shard.total,
    totalBytes: shard.totalBytes,
    maxPartRecords: shard.maxPartRecords,
    maxPartBytes: shard.maxPartBytes,
    targetMaxBytes: shard.targetMaxBytes,
    parts: shard.parts.map((part, index) => ({
      path: toPosix(part),
      records: shard.counts[index] || 0,
      bytes: shard.bytes[index] || 0
    }))
  },
  atomic: true
});

const runLoad = async (label, concurrency) => {
  const startTotal = performance.now();
  let count = 0;
  for (let i = 0; i < iterations; i += 1) {
    const rowsLoaded = await loadJsonArrayArtifact(indexDir, 'chunk_meta', {
      strict: false,
      concurrency
    });
    count += Array.isArray(rowsLoaded) ? rowsLoaded.length : 0;
  }
  const totalMs = performance.now() - startTotal;
  const throughput = count ? (count / (totalMs / 1000)) : 0;
  return { label, totalMs, throughput, count };
};

const printResult = (result) => {
  console.log(
    `[bench] ${result.label} duration=${result.totalMs.toFixed(1)}ms `
    + `throughput=${result.throughput.toFixed(1)}/s amount=${result.count}`
  );
};

const printDelta = (baseline, current) => {
  const deltaMs = current.totalMs - baseline.totalMs;
  const deltaPct = baseline.totalMs ? (deltaMs / baseline.totalMs) * 100 : 0;
  const deltaThroughput = current.throughput - baseline.throughput;
  const throughputPct = baseline.throughput ? (deltaThroughput / baseline.throughput) * 100 : 0;
  console.log(
    `[bench] delta duration=${deltaMs.toFixed(1)}ms (${deltaPct.toFixed(1)}%) `
    + `throughput=${deltaThroughput.toFixed(1)}/s (${throughputPct.toFixed(1)}%) `
    + `amount=${current.count}`
  );
};

let baseline = null;
let current = null;

if (mode !== 'current') {
  baseline = await runLoad('baseline', baselineConcurrency);
  printResult(baseline);
}

if (mode !== 'baseline') {
  current = await runLoad('current', currentConcurrency);
  printResult(current);
  if (baseline) {
    printDelta(baseline, current);
  }
}
