#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { buildFileMeta } from '../../../src/index/build/artifacts/file-meta.js';

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
const fileCount = Number(args.files) || 10000;
const chunksPerFile = Number(args.chunksPerFile) || 2;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const files = Array.from({ length: fileCount }, (_, index) => `src/file-${index}.ts`);

const buildState = ({ withDiscovery, withFileInfo, withChunkMap }) => {
  const chunks = [];
  const fileInfoByPath = withFileInfo ? new Map() : null;
  const chunkUidToFile = withChunkMap ? new Map() : null;
  for (const file of files) {
    if (fileInfoByPath) {
      fileInfoByPath.set(file, {
        size: 100 + file.length,
        hash: `hash-${file}`,
        hashAlgo: 'sha1'
      });
    }
    for (let i = 0; i < chunksPerFile; i += 1) {
      const chunkUid = `${file}::${i}`;
      chunks.push({
        file,
        chunkUid,
        ext: 'ts',
        fileSize: 100 + file.length,
        fileHash: `hash-${file}`,
        fileHashAlgo: 'sha1'
      });
      if (chunkUidToFile) {
        chunkUidToFile.set(chunkUid, file);
      }
    }
  }
  return {
    chunks,
    discoveredFiles: withDiscovery ? files.slice() : null,
    fileInfoByPath,
    chunkUidToFile
  };
};

const buildChunkUidMap = (state, fileIdByPath) => {
  const chunkUidToFileId = new Map();
  if (state?.chunkUidToFile && typeof state.chunkUidToFile.entries === 'function') {
    for (const [chunkUid, file] of state.chunkUidToFile.entries()) {
      const fileId = fileIdByPath.get(file);
      if (!Number.isFinite(fileId)) continue;
      if (!chunkUidToFileId.has(chunkUid)) {
        chunkUidToFileId.set(chunkUid, fileId);
      }
    }
  } else {
    for (const chunk of state?.chunks || []) {
      const file = chunk?.file || chunk?.metaV2?.file || null;
      const chunkUid = chunk?.chunkUid || chunk?.metaV2?.chunkUid || null;
      if (!file || !chunkUid) continue;
      const fileId = fileIdByPath.get(file);
      if (!Number.isFinite(fileId)) continue;
      if (!chunkUidToFileId.has(chunkUid)) {
        chunkUidToFileId.set(chunkUid, fileId);
      }
    }
  }
  return chunkUidToFileId;
};

const runOnce = (label, state) => {
  const totalChunks = state.chunks.length;
  const startMeta = performance.now();
  const meta = buildFileMeta(state);
  const fileMetaMs = performance.now() - startMeta;

  const startChunkMap = performance.now();
  const chunkMap = buildChunkUidMap(state, meta.fileIdByPath);
  const chunkMapMs = performance.now() - startChunkMap;

  const totalMs = fileMetaMs + chunkMapMs;
  return {
    label,
    fileMetaMs,
    chunkMapMs,
    totalMs,
    fileCount: meta.fileMeta.length,
    chunkCount: chunkMap.size,
    totalChunks
  };
};

const throughput = (count, ms) => (ms > 0 ? count / (ms / 1000) : 0);

const printResult = (result) => {
  const fileThroughput = throughput(result.fileCount, result.fileMetaMs);
  const chunkThroughput = throughput(result.totalChunks, result.chunkMapMs);
  console.log(
    `[bench] ${result.label} files=${result.fileCount} chunks=${result.totalChunks} ` +
    `fileMetaMs=${result.fileMetaMs.toFixed(1)} fileThroughput=${fileThroughput.toFixed(1)}/s ` +
    `chunkMapMs=${result.chunkMapMs.toFixed(1)} chunkThroughput=${chunkThroughput.toFixed(1)}/s ` +
    `totalMs=${result.totalMs.toFixed(1)}`
  );
  return { fileThroughput, chunkThroughput };
};

const printDelta = (baseline, current, baseT, curT) => {
  const deltaMs = current.totalMs - baseline.totalMs;
  const deltaPct = baseline.totalMs > 0 ? (deltaMs / baseline.totalMs) * 100 : 0;
  const deltaFileThroughput = curT.fileThroughput - baseT.fileThroughput;
  const deltaChunkThroughput = curT.chunkThroughput - baseT.chunkThroughput;
  console.log(
    `[bench] delta ms=${deltaMs.toFixed(1)} (${deltaPct.toFixed(1)}%) ` +
    `fileThroughput=${curT.fileThroughput.toFixed(1)}/s Δ=${deltaFileThroughput.toFixed(1)}/s ` +
    `chunkThroughput=${curT.chunkThroughput.toFixed(1)}/s Δ=${deltaChunkThroughput.toFixed(1)}/s`
  );
};

let baseline = null;
let current = null;
let baselineT = null;
let currentT = null;

if (mode !== 'current') {
  baseline = runOnce('baseline', buildState({ withDiscovery: false, withFileInfo: false, withChunkMap: false }));
  baselineT = printResult(baseline);
}

if (mode !== 'baseline') {
  current = runOnce('current', buildState({ withDiscovery: true, withFileInfo: true, withChunkMap: true }));
  currentT = printResult(current);
}

if (baseline && current) {
  printDelta(baseline, current, baselineT, currentT);
}
