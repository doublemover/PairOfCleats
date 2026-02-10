import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { createTempPath, replaceFile } from '../../../shared/json-stream/atomic.js';
import { createOffsetsWriter } from '../../../shared/json-stream/offsets.js';
import { compareStrings } from '../../../shared/sort.js';
import { createOrderingHasher, stableOrder } from '../../../shared/order.js';
import { writeJsonlRunFile } from '../../../shared/merge.js';
import { encodeVarintDeltas } from '../../../shared/artifact-io/varint.js';
import {
  OFFSETS_COMPRESSION,
  OFFSETS_FORMAT,
  OFFSETS_FORMAT_VERSION
} from '../../../shared/artifact-io/offsets.js';

const GRAPH_RELATION_GRAPHS = ['callGraph', 'usageGraph', 'importGraph'];
const GRAPH_RELATION_ORDER = new Map(GRAPH_RELATION_GRAPHS.map((name, index) => [name, index]));
export const createOffsetsMeta = ({ suffix = null, parts = null, compression = null } = {}) => {
  if (!Array.isArray(parts) || !parts.length) return null;
  return {
    version: OFFSETS_FORMAT_VERSION,
    format: OFFSETS_FORMAT,
    compression: compression || OFFSETS_COMPRESSION,
    suffix: suffix || null,
    parts
  };
};

export const createOffsetsIndexMeta = ({ path: offsetsPath = null, count = null, compression = null } = {}) => ({
  version: OFFSETS_FORMAT_VERSION,
  format: OFFSETS_FORMAT,
  compression: compression || OFFSETS_COMPRESSION,
  path: offsetsPath,
  count
});

export const createByteTracker = ({ maxJsonBytes = null } = {}) => {
  const stats = {
    totalBytes: 0,
    totalRows: 0,
    maxRowBytes: 0
  };
  const track = (row, { stringified = null } = {}) => {
    const line = stringified ?? JSON.stringify(row);
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (maxJsonBytes && lineBytes > maxJsonBytes) {
      const err = new Error(`JSONL entry exceeds maxBytes (${lineBytes} > ${maxJsonBytes}).`);
      err.code = 'ERR_JSON_TOO_LARGE';
      throw err;
    }
    stats.totalBytes += lineBytes + 1;
    stats.totalRows += 1;
    stats.maxRowBytes = Math.max(stats.maxRowBytes, lineBytes);
    return { line, lineBytes };
  };
  return { stats, track };
};

export const trackBytesForRow = (stats, row, { stringified = null, maxJsonBytes = null } = {}) => {
  if (!stats) return { line: null, lineBytes: 0 };
  const line = stringified ?? JSON.stringify(row);
  const lineBytes = Buffer.byteLength(line, 'utf8');
  if (maxJsonBytes && lineBytes > maxJsonBytes) {
    const err = new Error(`JSONL entry exceeds maxBytes (${lineBytes} > ${maxJsonBytes}).`);
    err.code = 'ERR_JSON_TOO_LARGE';
    throw err;
  }
  stats.totalBytes = (stats.totalBytes || 0) + lineBytes + 1;
  stats.totalRows = (stats.totalRows || 0) + 1;
  stats.maxRowBytes = Math.max(stats.maxRowBytes || 0, lineBytes);
  return { line, lineBytes };
};

export const createTrimStats = () => ({
  totalRows: 0,
  trimmedRows: 0,
  droppedRows: 0,
  dedupedRows: 0,
  dedupeCollisions: 0,
  totalBytes: 0,
  maxRowBytes: 0,
  runsSpilled: 0,
  spillBytes: 0
});

export const recordTrimStats = (stats, {
  rowBytes = 0,
  trimmed = false,
  dropped = false,
  deduped = false,
  dedupeCollision = false
} = {}) => {
  if (!stats) return;
  stats.totalRows += (dropped || deduped) ? 0 : 1;
  if (trimmed) stats.trimmedRows += 1;
  if (dropped) stats.droppedRows += 1;
  if (deduped) stats.dedupedRows += 1;
  if (dedupeCollision) stats.dedupeCollisions += 1;
  if (rowBytes) {
    stats.totalBytes += rowBytes;
    stats.maxRowBytes = Math.max(stats.maxRowBytes, rowBytes);
  }
};

export const recordArtifactTelemetry = (recorder, {
  stage,
  artifact,
  rows,
  bytes,
  maxRowBytes,
  trimmedRows,
  droppedRows,
  extra = null
} = {}) => {
  if (!recorder?.record) return;
  recorder.record({
    stage: stage || 'artifacts',
    step: 'artifact',
    label: artifact || null,
    extra: {
      artifact: artifact || null,
      rows: Number.isFinite(rows) ? rows : null,
      bytes: Number.isFinite(bytes) ? bytes : null,
      maxRowBytes: Number.isFinite(maxRowBytes) ? maxRowBytes : null,
      trimmedRows: Number.isFinite(trimmedRows) ? trimmedRows : null,
      droppedRows: Number.isFinite(droppedRows) ? droppedRows : null,
      ...extra
    }
  });
};

export const createRowSpillCollector = ({
  outDir,
  runPrefix,
  compare,
  maxBufferBytes = 2 * 1024 * 1024,
  maxBufferRows = 5000,
  maxJsonBytes = null,
  stats = createTrimStats(),
  mapRow = null,
  serialize = null,
  scheduleIo = null
} = {}) => {
  const buffer = [];
  let bufferBytes = 0;
  let runsDir = null;
  let runIndex = 0;
  const runs = [];
  let dedupeBuckets = null;
  const compareRows = typeof compare === 'function' ? compare : compareStrings;
  const wrapRow = typeof mapRow === 'function' ? mapRow : (row) => row;
  const serializeRow = typeof serialize === 'function' ? serialize : (row) => JSON.stringify(row);
  const schedule = typeof scheduleIo === 'function' ? scheduleIo : (fn) => fn();
  const runDirName = `${runPrefix || 'rows'}.runs`;

  const ensureRunsDir = async () => {
    if (runsDir) return runsDir;
    if (!outDir) throw new Error('row spill collector requires outDir');
    runsDir = path.join(outDir, runDirName);
    await schedule(() => fs.promises.mkdir(runsDir, { recursive: true }));
    return runsDir;
  };

  const spill = async () => {
    if (!buffer.length) return;
    buffer.sort(compareRows);
    const dir = await ensureRunsDir();
    const runName = `${runPrefix || 'rows'}.run-${String(runIndex).padStart(5, '0')}.jsonl`;
    const runPath = path.join(dir, runName);
    runIndex += 1;
    const spillBytes = bufferBytes;
    await schedule(() => writeJsonlRunFile(runPath, buffer, { atomic: true, serialize: serializeRow }));
    runs.push(runPath);
    if (stats) {
      stats.runsSpilled = (stats.runsSpilled || 0) + 1;
      stats.spillBytes = (stats.spillBytes || 0) + spillBytes;
    }
    buffer.length = 0;
    bufferBytes = 0;
    if (dedupeBuckets) {
      for (const bucket of dedupeBuckets.values()) bucket.clear();
      dedupeBuckets.clear();
    }
  };

  const append = async (
    row,
    {
      trimmed = false,
      dropped = false,
      dedupeHash = null,
      dedupeFingerprint = null,
      line = null,
      lineBytes = null
    } = {}
  ) => {
    if (!row || dropped) {
      recordTrimStats(stats, { dropped: true });
      return;
    }
    if (dedupeHash != null) {
      if (!dedupeBuckets) dedupeBuckets = new Map();
      let bucket = dedupeBuckets.get(dedupeHash);
      if (!bucket) {
        bucket = new Set();
        dedupeBuckets.set(dedupeHash, bucket);
      }
      if (bucket.size && !bucket.has(dedupeFingerprint)) {
        recordTrimStats(stats, { dedupeCollision: true });
      }
      if (bucket.has(dedupeFingerprint)) {
        recordTrimStats(stats, { deduped: true });
        return;
      }
      bucket.add(dedupeFingerprint);
    }
    const resolvedLine = line ?? serializeRow(row);
    const resolvedBytes = lineBytes == null
      ? Buffer.byteLength(resolvedLine, 'utf8') + 1
      : Math.max(0, Math.floor(Number(lineBytes)));
    if (maxJsonBytes && resolvedBytes > maxJsonBytes) {
      const err = new Error(`JSONL entry exceeds maxBytes (${resolvedBytes} > ${maxJsonBytes}).`);
      err.code = 'ERR_JSON_TOO_LARGE';
      throw err;
    }
    recordTrimStats(stats, { rowBytes: resolvedBytes, trimmed });
    buffer.push(wrapRow(row, { line: resolvedLine, lineBytes: resolvedBytes }));
    bufferBytes += resolvedBytes;
    const overflow = (maxBufferBytes && bufferBytes >= maxBufferBytes)
      || (maxBufferRows && buffer.length >= maxBufferRows);
    if (overflow) {
      await spill();
    }
  };

  const finalize = async () => {
    if (runs.length) {
      if (buffer.length) await spill();
      return {
        runs: runs.slice(),
        stats,
        cleanup: async () => {
          if (runsDir) {
            await schedule(() => fs.promises.rm(runsDir, { recursive: true, force: true }));
          }
        }
      };
    }
    if (buffer.length) buffer.sort(compareRows);
    return {
      rows: buffer,
      stats,
      cleanup: async () => {
        if (runsDir) {
          await schedule(() => fs.promises.rm(runsDir, { recursive: true, force: true }));
        }
      }
    };
  };

  return {
    append,
    finalize,
    stats
  };
};

const writeBuffer = async (stream, buffer) => {
  if (!buffer || buffer.length === 0) return;
  if (!stream.write(buffer)) {
    await once(stream, 'drain');
  }
};

export const writePerFileVarintIndex = async ({
  outDir,
  baseName,
  fileCount,
  perFileRows,
  atomic = true
}) => {
  if (!outDir || !baseName) return null;
  if (!Number.isFinite(fileCount) || fileCount <= 0) return null;
  if (!Array.isArray(perFileRows)) return null;
  const dataPath = path.join(outDir, `${baseName}.bin`);
  const offsetsPath = path.join(outDir, `${baseName}.offsets.bin`);
  const targetPath = atomic ? createTempPath(dataPath) : dataPath;
  const stream = fs.createWriteStream(targetPath);
  const offsetsWriter = createOffsetsWriter(offsetsPath, { atomic });
  let bytesWritten = 0;
  try {
    for (let i = 0; i < fileCount; i += 1) {
      await offsetsWriter.writeOffset(bytesWritten);
      const rows = Array.isArray(perFileRows[i]) ? perFileRows[i] : [];
      if (!rows.length) continue;
      const buffer = encodeVarintDeltas(rows);
      bytesWritten += buffer.length;
      await writeBuffer(stream, buffer);
    }
    await offsetsWriter.writeOffset(bytesWritten);
    stream.end();
    await once(stream, 'finish');
    if (atomic) {
      await replaceFile(targetPath, dataPath);
    }
    await offsetsWriter.close();
  } catch (err) {
    try { stream.destroy(err); } catch {}
    try { await once(stream, 'close'); } catch {}
    try { await offsetsWriter.destroy(err); } catch {}
    if (atomic) {
      try { await fs.promises.rm(targetPath, { force: true }); } catch {}
    }
    throw err;
  }
  return { dataPath, offsetsPath, bytesWritten };
};

export const compareSymbolOccurrenceRows = (a, b) => {
  const fileCmp = compareStrings(a?.host?.file, b?.host?.file);
  if (fileCmp) return fileCmp;
  const uidCmp = compareStrings(a?.host?.chunkUid, b?.host?.chunkUid);
  if (uidCmp) return uidCmp;
  const roleCmp = compareStrings(a?.role, b?.role);
  if (roleCmp) return roleCmp;
  const nameCmp = compareStrings(a?.ref?.targetName, b?.ref?.targetName);
  if (nameCmp) return nameCmp;
  return compareStrings(a?.ref?.status, b?.ref?.status);
};

export const compareSymbolEdgeRows = (a, b) => {
  const fromCmp = compareStrings(a?.from?.chunkUid, b?.from?.chunkUid);
  if (fromCmp) return fromCmp;
  const typeCmp = compareStrings(a?.type, b?.type);
  if (typeCmp) return typeCmp;
  const nameCmp = compareStrings(a?.to?.targetName, b?.to?.targetName);
  if (nameCmp) return nameCmp;
  return compareStrings(a?.to?.status, b?.to?.status);
};

export const compareChunkMetaRows = (a, b) => {
  const fileCmp = compareStrings(a?.file, b?.file);
  if (fileCmp) return fileCmp;
  const uidCmp = compareStrings(a?.chunkUid, b?.chunkUid);
  if (uidCmp) return uidCmp;
  const idCmp = compareStrings(a?.chunkId ?? a?.id, b?.chunkId ?? b?.id);
  if (idCmp) return idCmp;
  const startA = Number.isFinite(Number(a?.start)) ? Number(a.start) : null;
  const startB = Number.isFinite(Number(b?.start)) ? Number(b.start) : null;
  if (startA != null && startB != null && startA !== startB) return startA - startB;
  return compareStrings(a?.name, b?.name);
};

export const compareChunkMetaRowsById = (a, b) => {
  const idA = Number.isFinite(Number(a?.id)) ? Number(a.id) : null;
  const idB = Number.isFinite(Number(b?.id)) ? Number(b.id) : null;
  if (idA != null && idB != null && idA !== idB) return idA - idB;
  if (idA != null && idB == null) return -1;
  if (idA == null && idB != null) return 1;
  return compareChunkMetaRows(a, b);
};

export const compareGraphRelationRows = (a, b) => {
  const graphCmp = (GRAPH_RELATION_ORDER.get(a?.graph) ?? 99) - (GRAPH_RELATION_ORDER.get(b?.graph) ?? 99);
  if (graphCmp) return graphCmp;
  return compareStrings(a?.node?.id, b?.node?.id);
};

export { formatBytes } from '../../../shared/disk-space.js';

export const summarizeFilterIndex = (value) => {
  if (!value || typeof value !== 'object') return null;
  const countMap = (map) => {
    if (!map || typeof map !== 'object') return { keys: 0, entries: 0 };
    let keys = 0;
    let entries = 0;
    for (const list of Object.values(map)) {
      keys += 1;
      if (Array.isArray(list)) entries += list.length;
    }
    return { keys, entries };
  };
  const fileById = Array.isArray(value.fileById) ? value.fileById : [];
  const fileChunksById = Array.isArray(value.fileChunksById) ? value.fileChunksById : [];
  const fileChunkRefs = fileChunksById.reduce(
    (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
    0
  );
  let jsonBytes = null;
  try {
    jsonBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {}
  return {
    fileChargramN: Number.isFinite(Number(value.fileChargramN)) ? Number(value.fileChargramN) : null,
    fileCount: fileById.length,
    fileChunkRefs,
    byExt: countMap(value.byExt),
    byKind: countMap(value.byKind),
    byAuthor: countMap(value.byAuthor),
    byChunkAuthor: countMap(value.byChunkAuthor),
    byVisibility: countMap(value.byVisibility),
    fileChargrams: countMap(value.fileChargrams),
    jsonBytes
  };
};

export const createGraphRelationsIterator = (relations, options = {}) => function* graphRelationsIterator() {
  if (!relations || typeof relations !== 'object') return;
  const { byteBudget = null, stats = null } = options;
  let totalBytes = 0;
  let dropping = false;
  for (const graphName of GRAPH_RELATION_GRAPHS) {
    const nodeIterator = iterateGraphNodes(relations, graphName);
    for (const node of nodeIterator) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
      const row = { graph: graphName, node };
      if (byteBudget && !dropping) {
        const lineBytes = Buffer.byteLength(JSON.stringify(row), 'utf8') + 1;
        if (totalBytes + lineBytes > byteBudget) {
          dropping = true;
          if (stats) {
            stats.byteBudget = byteBudget;
            stats.truncated = true;
          }
        } else {
          totalBytes += lineBytes;
          yield row;
          continue;
        }
      }
      if (dropping) {
        if (stats) {
          stats.droppedRows = (stats.droppedRows || 0) + 1;
          stats.droppedByGraph = stats.droppedByGraph || {};
          stats.droppedByGraph[graphName] = (stats.droppedByGraph[graphName] || 0) + 1;
        }
        continue;
      }
      yield row;
    }
  }
};

export const measureGraphRelations = (relations, { maxJsonBytes } = {}) => {
  if (!relations || typeof relations !== 'object') return null;
  const graphs = {};
  const graphSizes = {};
  let totalJsonlBytes = 0;
  let totalEntries = 0;
  let maxRowBytes = 0;
  const orderingHasher = createOrderingHasher();
  for (const graphName of GRAPH_RELATION_GRAPHS) {
    const graph = relations[graphName] || {};
    const graphObj = relations?.__graphs?.[graphName] || null;
    const nodesIterator = iterateGraphNodes(relations, graphName);
    const graphKey = JSON.stringify(graphName);
    const nodeCount = Number.isFinite(graph.nodeCount)
      ? graph.nodeCount
      : (graphObj ? graphObj.order : 0);
    const hasEdgeCount = Number.isFinite(graph.edgeCount);
    const hasGraphObj = !!graphObj;
    let edgeCount = hasEdgeCount
      ? graph.edgeCount
      : (hasGraphObj ? graphObj.size : 0);
    const countEdgesFromNodes = !hasEdgeCount && !hasGraphObj;
    graphs[graphName] = { nodeCount, edgeCount };
    let nodesBytes = 0;
    let nodeIndex = 0;
    for (const node of nodesIterator) {
      const nodeJson = JSON.stringify(node);
      nodesBytes += Buffer.byteLength(nodeJson, 'utf8') + (nodeIndex > 0 ? 1 : 0);
      const line = `{"graph":${graphKey},"node":${nodeJson}}`;
      const lineBytes = Buffer.byteLength(line, 'utf8');
      orderingHasher.update(line);
      maxRowBytes = Math.max(maxRowBytes, lineBytes);
      if (maxJsonBytes && (lineBytes + 1) > maxJsonBytes) {
        throw new Error(`graph_relations entry exceeds max JSON size (${lineBytes} bytes).`);
      }
      totalJsonlBytes += lineBytes + 1;
      totalEntries += 1;
      nodeIndex += 1;
      if (countEdgesFromNodes) {
        edgeCount += Array.isArray(node?.out) ? node.out.length : 0;
      }
    }
    const baseGraphBytes = Buffer.byteLength(
      JSON.stringify({ nodeCount, edgeCount, nodes: [] }),
      'utf8'
    );
    graphSizes[graphName] = baseGraphBytes + nodesBytes;
  }
  const version = Number.isFinite(relations.version) ? relations.version : 1;
  const generatedAt = typeof relations.generatedAt === 'string'
    ? relations.generatedAt
    : new Date().toISOString();
  const basePayload = {
    version,
    generatedAt,
    callGraph: {},
    usageGraph: {},
    importGraph: {}
  };
  if (relations.caps !== undefined) basePayload.caps = relations.caps;
  const baseBytes = Buffer.byteLength(JSON.stringify(basePayload), 'utf8');
  const totalJsonBytes = baseBytes
    + graphSizes.callGraph - 2
    + graphSizes.usageGraph - 2
    + graphSizes.importGraph - 2;
  const orderingResult = totalEntries ? orderingHasher.digest() : null;
  return {
    totalJsonBytes,
    totalJsonlBytes,
    totalEntries,
    graphs,
    version,
    generatedAt,
    maxRowBytes,
    orderingHash: orderingResult?.hash || null,
    orderingCount: orderingResult?.count || 0
  };
};

export const iterateGraphNodes = (relations, graphName) => {
  const graph = relations?.[graphName];
  if (Array.isArray(graph?.nodes)) {
    const nodes = stableOrder(graph.nodes, [(node) => node?.id ?? null]);
    return nodes[Symbol.iterator]();
  }
  const graphObj = relations?.__graphs?.[graphName];
  if (!graphObj) {
    return [][Symbol.iterator]();
  }
  const ids = stableOrder(graphObj.nodes().slice(), [(id) => id]);
  return (function* graphNodeIterator() {
    for (const id of ids) {
      const attrs = graphObj.getNodeAttributes(id) || {};
      const out = stableOrder(graphObj.outNeighbors(id).slice(), [(value) => value]);
      const incoming = stableOrder(graphObj.inNeighbors(id).slice(), [(value) => value]);
      yield { id, ...attrs, out, in: incoming };
    }
  })();
};

export const materializeGraphRelationsPayload = (relations) => {
  if (!relations || typeof relations !== 'object') return relations;
  const buildGraph = (graphName) => {
    const graph = relations?.[graphName] || {};
    if (Array.isArray(graph?.nodes)) return graph;
    const nodes = [];
    const nodeIterator = iterateGraphNodes(relations, graphName);
    for (const node of nodeIterator) nodes.push(node);
    const graphObj = relations?.__graphs?.[graphName] || null;
    const nodeCount = Number.isFinite(graph?.nodeCount)
      ? graph.nodeCount
      : (graphObj ? graphObj.order : nodes.length);
    const edgeCount = Number.isFinite(graph?.edgeCount)
      ? graph.edgeCount
      : (graphObj ? graphObj.size : 0);
    return { nodeCount, edgeCount, nodes };
  };
  const output = {
    version: Number.isFinite(relations.version) ? relations.version : 1,
    generatedAt: typeof relations.generatedAt === 'string' ? relations.generatedAt : new Date().toISOString(),
    callGraph: buildGraph('callGraph'),
    usageGraph: buildGraph('usageGraph'),
    importGraph: buildGraph('importGraph')
  };
  if (relations.caps !== undefined) output.caps = relations.caps;
  return output;
};

export const buildGraphRelationsCsr = (relations) => {
  if (!relations || typeof relations !== 'object') return null;
  const version = Number.isFinite(relations.version) ? relations.version : 1;
  const generatedAt = typeof relations.generatedAt === 'string'
    ? relations.generatedAt
    : new Date().toISOString();
  const graphs = {};
  for (const graphName of GRAPH_RELATION_GRAPHS) {
    const graphObj = relations?.__graphs?.[graphName] || null;
    const nodeEntries = graphObj ? null : Array.from(iterateGraphNodes(relations, graphName));
    const nodes = graphObj
      ? stableOrder(graphObj.nodes().slice(), [(id) => id])
      : stableOrder(nodeEntries.map((node) => node.id), [(id) => id]);
    const outById = nodeEntries
      ? nodeEntries.reduce((acc, node) => {
        acc.set(node.id, Array.isArray(node.out) ? node.out : []);
        return acc;
      }, new Map())
      : null;
    const idToIndex = new Map(nodes.map((id, index) => [id, index]));
    const offsets = new Array(nodes.length + 1);
    const edges = [];
    offsets[0] = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      const id = nodes[i];
      const out = graphObj
        ? stableOrder(graphObj.outNeighbors(id).slice(), [(value) => value])
        : (outById?.get(id) || []);
      const outList = graphObj ? out : (Array.isArray(out) ? stableOrder(out.slice(), [(value) => value]) : []);
      for (const target of outList) {
        const targetIndex = idToIndex.get(target);
        if (Number.isFinite(targetIndex)) edges.push(targetIndex);
      }
      offsets[i + 1] = edges.length;
    }
    graphs[graphName] = {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodes,
      offsets,
      edges
    };
  }
  return { version, generatedAt, graphs };
};

export const estimatePostingsBytes = (vocab, postingsList, sampleLimit = 200) => {
  const total = Array.isArray(vocab) ? vocab.length : 0;
  if (!total) return null;
  const sampleSize = Math.min(total, sampleLimit);
  let sampledBytes = 0;
  for (let i = 0; i < sampleSize; i += 1) {
    const token = vocab[i];
    const posting = postingsList?.[i] || [];
    sampledBytes += Buffer.byteLength(JSON.stringify(token), 'utf8') + 1;
    sampledBytes += Buffer.byteLength(JSON.stringify(posting), 'utf8') + 1;
  }
  if (!sampledBytes) return null;
  const avgBytes = sampledBytes / sampleSize;
  return { avgBytes, estimatedBytes: avgBytes * total };
};
