#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';
import { buildRelationGraphs } from '../../../src/index/build/graphs.js';
import { readJsonFile } from '../../../src/shared/artifact-io/json.js';
import { parseSimpleBenchArgs } from '../shared.js';
import {
  buildRelationBenchChunks,
  buildRelationBenchFileRelations,
  writeRelationBenchGraphArtifacts
} from './relations-fixture.js';

const args = parseSimpleBenchArgs();
const chunkCount = Math.max(10, Number(args.chunks) || 10000);
const edgesPerChunk = Math.max(0, Number(args.edges) || 2);
const maxBytes = Math.max(1024 * 32, Number(args.maxBytes) || 256 * 1024);
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const benchRoot = path.join(process.cwd(), '.benchCache', 'relations-build');
await fs.rm(benchRoot, { recursive: true, force: true });
await fs.mkdir(benchRoot, { recursive: true });

const chunks = buildRelationBenchChunks({ chunkCount, edgesPerChunk });
const fileRelations = buildRelationBenchFileRelations();

const runBaseline = async () => {
  const outDir = path.join(benchRoot, 'baseline');
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const graphPath = path.join(outDir, 'graph_relations.json');
  const start = performance.now();
  const relations = buildRelationGraphs({ chunks, fileRelations });
  await writeJsonObjectFile(graphPath, { fields: relations, atomic: true });
  const durationMs = performance.now() - start;
  const stat = await fs.stat(graphPath);
  return { durationMs, bytes: stat.size };
};

const runCurrent = async () => {
  const outDir = path.join(benchRoot, 'current');
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const start = performance.now();
  await writeRelationBenchGraphArtifacts({
    outDir,
    chunks,
    fileRelations,
    maxJsonBytes: maxBytes
  });
  const durationMs = performance.now() - start;
  const metaRaw = readJsonFile(path.join(outDir, 'graph_relations.meta.json'), { maxBytes: 1024 * 1024 });
  const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
  const totalBytes = Number.isFinite(meta?.totalBytes) ? meta.totalBytes : null;
  return { durationMs, bytes: totalBytes };
};

const printBaseline = (result) => {
  console.log(`[bench] baseline ms=${result.durationMs.toFixed(1)} bytes=${result.bytes}`);
};

const printCurrent = (result, baseline = null) => {
  const parts = [
    `ms=${result.durationMs.toFixed(1)}`,
    `bytes=${result.bytes}`
  ];
  let delta = null;
  let pct = null;
  if (baseline) {
    delta = result.durationMs - baseline.durationMs;
    pct = baseline.durationMs > 0 ? (delta / baseline.durationMs) * 100 : null;
    parts.push(`delta=${delta.toFixed(1)}ms (${pct?.toFixed(1)}%)`);
  }
  console.log(`[bench] current ${parts.join(' ')}`);
  if (baseline) {
    console.log(`[bench] delta ms=${delta.toFixed(1)} (${pct?.toFixed(1)}%) bytes=${result.bytes - baseline.bytes}`);
  }
};

let baseline = null;
if (mode !== 'current') {
  baseline = await runBaseline();
  printBaseline(baseline);
}
if (mode !== 'baseline') {
  const current = await runCurrent();
  printCurrent(current, baseline);
}
