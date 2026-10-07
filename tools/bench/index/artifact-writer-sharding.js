#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonLinesSharded } from '../../../src/shared/json-stream/jsonl-sharded.js';
import { writeJsonArrayFile } from '../../../src/shared/json-stream/json-writers.js';
import { parseSimpleBenchArgs } from '../shared.js';
import {
  printThroughputResult,
  runComparedThroughputBenchmarks
} from './throughput-compare.js';

const args = parseSimpleBenchArgs();
const rows = Number(args.rows) || 200000;
const payloadBytes = Number(args.payloadBytes) || 128;
const maxBytes = Number(args.maxBytes) || 4 * 1024 * 1024;
const compression = typeof args.compression === 'string'
  ? args.compression.toLowerCase()
  : 'zstd';
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const benchRoot = path.join(process.cwd(), '.benchCache', 'artifact-writer-sharding');
await fs.mkdir(benchRoot, { recursive: true });

const buildRows = () => {
  const payload = 'x'.repeat(Math.max(1, payloadBytes));
  return Array.from({ length: rows }, (_, index) => ({ id: index, payload }));
};

const runBaseline = async (items) => {
  const outPath = path.join(benchRoot, 'baseline.json');
  await fs.rm(outPath, { force: true });
  const start = performance.now();
  await writeJsonArrayFile(outPath, items, { atomic: true });
  const durationMs = performance.now() - start;
  const bytes = (await fs.stat(outPath)).size;
  return { label: 'baseline', durationMs, bytes };
};

const runCurrent = async (items) => {
  const partsDirName = 'current-parts';
  const partsDir = path.join(benchRoot, partsDirName);
  await fs.rm(partsDir, { recursive: true, force: true });
  const start = performance.now();
  const result = await writeJsonLinesSharded({
    dir: benchRoot,
    partsDirName,
    partPrefix: 'rows-',
    items,
    maxBytes,
    compression: compression === 'none' ? null : compression,
    atomic: true
  });
  const durationMs = performance.now() - start;
  return {
    label: 'current',
    durationMs,
    bytes: result.totalBytes,
    parts: result.parts.length
  };
};

const printResult = (result) => {
  const extras = result.parts != null ? ` parts=${result.parts}` : '';
  return printThroughputResult(result, { itemLabel: 'rows', items: rows, extras });
};

const items = buildRows();
await runComparedThroughputBenchmarks({
  mode,
  runBaseline: () => runBaseline(items),
  runCurrent: () => runCurrent(items),
  printResult
});
