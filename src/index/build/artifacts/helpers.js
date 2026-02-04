import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { writeJsonLinesFile } from '../../../shared/json-stream.js';
import { compareStrings } from '../../../shared/sort.js';

const GRAPH_RELATION_GRAPHS = ['callGraph', 'usageGraph', 'importGraph'];
const GRAPH_RELATION_ORDER = new Map(GRAPH_RELATION_GRAPHS.map((name, index) => [name, index]));

export class MinHeap {
  constructor(compare) {
    this.compare = compare;
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(value) {
    this.items.push(value);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    if (!this.items.length) return null;
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  bubbleUp(index) {
    const { items, compare } = this;
    let i = index;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (compare(items[i], items[parent]) >= 0) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }

  bubbleDown(index) {
    const { items, compare } = this;
    let i = index;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < items.length && compare(items[left], items[smallest]) < 0) {
        smallest = left;
      }
      if (right < items.length && compare(items[right], items[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === i) break;
      [items[i], items[smallest]] = [items[smallest], items[i]];
      i = smallest;
    }
  }
}

export const readJsonlRows = async function* (filePath) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      yield JSON.parse(trimmed);
    }
  } finally {
    rl.close();
    stream.destroy();
  }
};

export const mergeSortedRuns = async function* (runs, { compare, readRun = readJsonlRows } = {}) {
  const compareFn = typeof compare === 'function' ? compare : compareStrings;
  const advance = async (cursor) => {
    const next = await cursor.iterator.next();
    if (next.done) {
      cursor.done = true;
      cursor.row = null;
      return false;
    }
    cursor.row = next.value;
    return true;
  };
  const heap = new MinHeap((a, b) => {
    const cmp = compareFn(a.row, b.row);
    if (cmp !== 0) return cmp;
    return a.order - b.order;
  });
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    if (!run) continue;
    const iterator = readRun(run)[Symbol.asyncIterator]();
    const cursor = { iterator, row: null, done: false, order: i };
    const hasRow = await advance(cursor);
    if (hasRow) heap.push(cursor);
  }
  while (heap.size) {
    const best = heap.pop();
    if (!best) break;
    yield best.row;
    const hasMore = await advance(best);
    if (hasMore) heap.push(best);
  }
};

export const writeJsonlRunFile = async (filePath, rows, { atomic = true } = {}) => (
  writeJsonLinesFile(filePath, rows, { atomic })
);

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
  totalBytes: 0,
  maxRowBytes: 0
});

export const recordTrimStats = (stats, { rowBytes = 0, trimmed = false, dropped = false } = {}) => {
  if (!stats) return;
  stats.totalRows += dropped ? 0 : 1;
  if (trimmed) stats.trimmedRows += 1;
  if (dropped) stats.droppedRows += 1;
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

export const compareGraphRelationRows = (a, b) => {
  const graphCmp = (GRAPH_RELATION_ORDER.get(a?.graph) ?? 99) - (GRAPH_RELATION_ORDER.get(b?.graph) ?? 99);
  if (graphCmp) return graphCmp;
  return compareStrings(a?.node?.id, b?.node?.id);
};

export const formatBytes = (bytes) => {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0B';
  if (value < 1024) return `${Math.round(value)}B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)}GB`;
};

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

export const createGraphRelationsIterator = (relations) => function* graphRelationsIterator() {
  if (!relations || typeof relations !== 'object') return;
  for (const graphName of GRAPH_RELATION_GRAPHS) {
    const graph = relations[graphName];
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    for (const node of nodes) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
      yield { graph: graphName, node };
    }
  }
};

export const measureGraphRelations = (relations, { maxJsonBytes } = {}) => {
  if (!relations || typeof relations !== 'object') return null;
  const graphs = {};
  const graphSizes = {};
  let totalJsonlBytes = 0;
  let totalEntries = 0;
  for (const graphName of GRAPH_RELATION_GRAPHS) {
    const graph = relations[graphName] || {};
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const graphKey = JSON.stringify(graphName);
    const nodeCount = Number.isFinite(graph.nodeCount) ? graph.nodeCount : nodes.length;
    const edgeCount = Number.isFinite(graph.edgeCount)
      ? graph.edgeCount
      : nodes.reduce((sum, node) => sum + (Array.isArray(node?.out) ? node.out.length : 0), 0);
    graphs[graphName] = { nodeCount, edgeCount };
    let nodesBytes = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const nodeJson = JSON.stringify(node);
      nodesBytes += Buffer.byteLength(nodeJson, 'utf8') + (i > 0 ? 1 : 0);
      const line = `{"graph":${graphKey},"node":${nodeJson}}`;
      const lineBytes = Buffer.byteLength(line, 'utf8');
      if (maxJsonBytes && (lineBytes + 1) > maxJsonBytes) {
        throw new Error(`graph_relations entry exceeds max JSON size (${lineBytes} bytes).`);
      }
      totalJsonlBytes += lineBytes + 1;
      totalEntries += 1;
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
  return { totalJsonBytes, totalJsonlBytes, totalEntries, graphs, version, generatedAt };
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
