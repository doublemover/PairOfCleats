#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { buildRelationGraphs } from '../../../src/index/build/graphs.js';
import { enqueueGraphRelationsArtifacts } from '../../../src/index/build/artifacts/graph-relations.js';
import { readJsonFile } from '../../../src/shared/artifact-io.js';

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
const chunkCount = Math.max(10, Number(args.chunks) || 10000);
const edgesPerChunk = Math.max(0, Number(args.edges) || 2);
const maxBytes = Math.max(1024 * 32, Number(args.maxBytes) || 256 * 1024);
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const benchRoot = path.join(process.cwd(), '.benchCache', 'relations-build');
await fs.rm(benchRoot, { recursive: true, force: true });
await fs.mkdir(benchRoot, { recursive: true });

const buildChunks = () => {
  const chunks = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i += 1) {
    const file = `src/file-${String(i % 250).padStart(3, '0')}.js`;
    const uid = `u${i}`;
    const callDetails = [];
    for (let j = 1; j <= edgesPerChunk; j += 1) {
      callDetails.push({ targetChunkUid: `u${(i + j) % chunkCount}` });
    }
    chunks[i] = {
      file,
      ext: '.js',
      name: `sym${i}`,
      kind: 'FunctionDeclaration',
      chunkUid: uid,
      metaV2: {
        chunkUid: uid,
        lang: 'javascript',
        effective: { languageId: 'javascript' },
        symbol: { symbolId: `sym-${i}` }
      },
      codeRelations: { callDetails }
    };
  }
  return chunks;
};

const buildFileRelations = () => new Map([
  ['src/file-000.js', { importLinks: ['src/file-001.js'] }],
  ['src/file-001.js', { importLinks: ['src/file-000.js'] }]
]);

const chunks = buildChunks();
const fileRelations = buildFileRelations();

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

  const toPosix = (value) => value.split(path.sep).join('/');
  const formatArtifactLabel = (filePath) => toPosix(path.relative(outDir, filePath));
  const removeArtifact = async (targetPath) => {
    await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
  };

  const start = performance.now();
  await enqueueGraphRelationsArtifacts({
    graphRelations: null,
    chunks,
    fileRelations,
    callSites: null,
    caps: null,
    outDir,
    maxJsonBytes: maxBytes,
    byteBudget: null,
    log: null,
    enqueueWrite: () => {
      throw new Error('enqueueWrite should not be called by streaming graph_relations build');
    },
    addPieceFile: () => {},
    formatArtifactLabel,
    removeArtifact,
    stageCheckpoints: null
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
  if (baseline) {
    const delta = result.durationMs - baseline.durationMs;
    const pct = baseline.durationMs > 0 ? (delta / baseline.durationMs) * 100 : null;
    parts.push(`delta=${delta.toFixed(1)}ms (${pct?.toFixed(1)}%)`);
  }
  console.log(`[bench] current ${parts.join(' ')}`);
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

