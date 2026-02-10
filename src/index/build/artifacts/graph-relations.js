import fs from 'node:fs/promises';
import path from 'node:path';
import {
  writeJsonLinesSharded,
  writeJsonLinesShardedAsync,
  writeJsonObjectFile
} from '../../../shared/json-stream.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../contracts/versioning.js';
import { fromPosix } from '../../../shared/files.js';
import { createOrderingHasher, stableOrder } from '../../../shared/order.js';
import { normalizeCap } from '../../../shared/limits.js';
import { mergeSortedRuns } from '../../../shared/merge.js';
import { compareStrings } from '../../../shared/sort.js';
import { resolveChunkId } from '../../chunk-id.js';
import { resolveRelativeImport } from '../../type-inference-crossfile/resolve-relative-import.js';
import { hashTokenId64Parts, TOKEN_ID_CONSTANTS } from '../../../shared/token-id.js';
import {
  buildGraphRelationsCsr,
  createRowSpillCollector,
  createOffsetsMeta,
  createGraphRelationsIterator,
  materializeGraphRelationsPayload,
  measureGraphRelations
} from './helpers.js';
import { applyByteBudget } from '../byte-budget.js';

const GRAPH_RELATION_GRAPHS = ['callGraph', 'usageGraph', 'importGraph'];
const GRAPH_RELATION_VERSION = 2;
const GRAPH_MAX_NODES = 200000;
const GRAPH_MAX_EDGES = 500000;
const GRAPH_SAMPLE_LIMIT = 5;

// Dedupe edges cheaply within spill buffers to reduce redundant spill rows.
// Collision strategy: primary hash + independent fingerprint (both fnv1a64 with distinct seeds).
const EDGE_DEDUPE_HASH_SEED = TOKEN_ID_CONSTANTS.DEFAULT_TOKEN_ID_SEED;
const EDGE_DEDUPE_FINGERPRINT_SEED = TOKEN_ID_CONSTANTS.DEFAULT_TOKEN_ID_SEED ^ 0x243f6a8885a308d3n;

const resolveCaps = (caps) => ({
  maxNodes: normalizeCap(caps?.maxNodes, GRAPH_MAX_NODES),
  maxEdges: normalizeCap(caps?.maxEdges, GRAPH_MAX_EDGES)
});

const resolveGraphCaps = (caps, label) => {
  if (!caps || typeof caps !== 'object') return resolveCaps(null);
  const perGraph = caps[label];
  if (perGraph && typeof perGraph === 'object') {
    return resolveCaps(perGraph);
  }
  return resolveCaps(caps);
};

const createGraphGuard = (label, caps) => ({
  label,
  maxNodes: caps?.maxNodes ?? GRAPH_MAX_NODES,
  maxEdges: caps?.maxEdges ?? GRAPH_MAX_EDGES,
  disabled: false,
  reason: null,
  cap: null,
  droppedNodes: 0,
  droppedEdges: 0,
  samples: []
});

const recordGraphSample = (guard, context) => {
  if (!guard || !context) return;
  if (guard.samples.length >= GRAPH_SAMPLE_LIMIT) return;
  guard.samples.push({
    file: context.file || null,
    chunkId: context.chunkId || null,
    chunkUid: context.chunkUid || null
  });
};

const normalizeChunkUid = (chunk) => chunk?.chunkUid || chunk?.metaV2?.chunkUid || null;

const buildLegacyChunkKey = (chunk) => {
  if (!chunk?.file || !chunk?.name) return null;
  return `${chunk.file}::${chunk.name}`;
};

const buildChunkNodeAttrs = (chunk) => {
  const chunkUid = normalizeChunkUid(chunk);
  const chunkId = resolveChunkId(chunk) || chunk?.metaV2?.chunkId || null;
  return {
    file: chunk.file,
    name: chunk.name,
    kind: chunk.kind || null,
    chunkId: chunkId || null,
    chunkUid: chunkUid || null,
    legacyKey: buildLegacyChunkKey(chunk),
    symbolId: chunk?.metaV2?.symbol?.symbolId || null
  };
};

const compareEdgesOut = (a, b) => {
  if (!a || !b) return a ? 1 : (b ? -1 : 0);
  if (a.g !== b.g) return a.g - b.g;
  const sCmp = compareStrings(a.s, b.s);
  if (sCmp) return sCmp;
  return compareStrings(a.t, b.t);
};

const compareEdgesIn = (a, b) => {
  if (!a || !b) return a ? 1 : (b ? -1 : 0);
  if (a.g !== b.g) return a.g - b.g;
  const tCmp = compareStrings(a.t, b.t);
  if (tCmp) return tCmp;
  return compareStrings(a.s, b.s);
};

const iterateEdges = async function* (collection, { compare } = {}) {
  if (!collection) return;
  if (Array.isArray(collection.rows)) {
    for (const row of collection.rows) yield row;
    return;
  }
  if (Array.isArray(collection.runs) && collection.runs.length) {
    for await (const row of mergeSortedRuns(collection.runs, { compare, validateComparator: true })) {
      yield row;
    }
  }
};

const groupNeighbors = async function* (edgeIterator, { key, neighbor } = {}) {
  let current = null;
  let lastNeighbor = null;
  for await (const edge of edgeIterator) {
    const g = edge?.g;
    const id = key(edge);
    const value = neighbor(edge);
    if (!Number.isFinite(g) || !id || !value) continue;
    if (!current || current.g !== g || current.id !== id) {
      if (current) yield current;
      current = { g, id, neighbors: [] };
      lastNeighbor = null;
    }
    if (value === lastNeighbor) continue;
    current.neighbors.push(value);
    lastNeighbor = value;
  }
  if (current) yield current;
};

const resolveByteCap = (byteBudget) => {
  if (!byteBudget) return null;
  const overflow = typeof byteBudget.overflow === 'string' ? byteBudget.overflow : null;
  if (overflow !== 'drop' && overflow !== 'skip') return null;
  const limit = Number.isFinite(byteBudget.maxBytes) ? Math.max(0, Math.floor(Number(byteBudget.maxBytes))) : null;
  return limit && limit > 0 ? limit : null;
};

const formatCapsLog = (caps) => (caps || [])
  .map((sample) => {
    const file = sample?.file || 'unknown';
    const chunkId = sample?.chunkId ? `#${sample.chunkId}` : '';
    return `${file}${chunkId}`;
  })
  .filter(Boolean)
  .join(', ');

const maybeLogCaps = (caps, logFn) => {
  if (!caps || typeof caps !== 'object' || typeof logFn !== 'function') return;
  for (const [label, guard] of Object.entries(caps)) {
    if (!guard?.reason) continue;
    const sampleText = formatCapsLog(guard.samples);
    const suffix = sampleText ? ` Examples: ${sampleText}` : '';
    logFn(`[relations] ${label} capped (${guard.reason}).${suffix}`);
  }
};

export async function enqueueGraphRelationsArtifacts({
  graphRelations,
  chunks = null,
  fileRelations = null,
  callSites = null,
  caps = null,
  outDir,
  maxJsonBytes,
  byteBudget = null,
  log,
  scheduleIo = null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  removeArtifact,
  stageCheckpoints
}) {
  const schedule = typeof scheduleIo === 'function' ? scheduleIo : (fn) => fn();
  const hasPayload = graphRelations && typeof graphRelations === 'object';
  const hasInputs = Array.isArray(chunks) && chunks.length;
  if (!hasPayload && !hasInputs) return;

  if (!hasPayload) {
    const generatedAt = new Date().toISOString();
    const graphMetaPath = path.join(outDir, 'graph_relations.meta.json');
    const graphPartsDir = path.join(outDir, 'graph_relations.parts');
    const offsetsConfig = { suffix: 'offsets.bin' };
    const csrPath = path.join(outDir, 'graph_relations.csr.json');
    const graphPath = path.join(outDir, 'graph_relations.json');
    const graphJsonlPath = path.join(outDir, 'graph_relations.jsonl');

    const stagingDir = path.join(outDir, 'graph_relations.staging');
    await schedule(() => fs.rm(stagingDir, { recursive: true, force: true }));
    await schedule(() => fs.mkdir(stagingDir, { recursive: true }));

    const chunkByUid = new Map();
    const chunkUids = [];
    const fileSet = new Set();
    for (const chunk of chunks) {
      const uid = normalizeChunkUid(chunk);
      if (!uid || !chunk?.file) continue;
      chunkByUid.set(uid, chunk);
      chunkUids.push(uid);
      fileSet.add(chunk.file);
    }

    const callGuard = createGraphGuard('callGraph', resolveGraphCaps(caps, 'callGraph'));
    const usageGuard = createGraphGuard('usageGraph', resolveGraphCaps(caps, 'usageGraph'));
    const importGuard = createGraphGuard('importGraph', resolveGraphCaps(caps, 'importGraph'));

    const sortedChunkUids = stableOrder(chunkUids.slice(), [(value) => value]);
    const applyNodeCap = (guard, ids) => {
      const maxNodes = Number.isFinite(guard?.maxNodes) ? guard.maxNodes : null;
      if (maxNodes == null) return { ids, allowed: null };
      if (maxNodes <= 0) {
        if (maxNodes === 0) {
          guard.reason = 'maxNodes';
          guard.cap = 'maxNodes';
          guard.droppedNodes = ids.length;
          return { ids: [], allowed: new Set() };
        }
        return { ids, allowed: null };
      }
      if (ids.length <= maxNodes) return { ids, allowed: null };
      guard.reason = 'maxNodes';
      guard.cap = 'maxNodes';
      guard.droppedNodes = ids.length - maxNodes;
      const allowedIds = ids.slice(0, maxNodes);
      const allowed = new Set(allowedIds);
      return { ids: allowedIds, allowed };
    };

    const callNodes = applyNodeCap(callGuard, sortedChunkUids);
    const usageNodes = applyNodeCap(usageGuard, sortedChunkUids);

    const useCallSites = Array.isArray(callSites) && callSites.length > 0;

    const spillBufferBytes = Math.max(256 * 1024, Math.min(8 * 1024 * 1024, Math.floor(Number(maxJsonBytes || 0) * 4) || (2 * 1024 * 1024)));
    const outCollector = createRowSpillCollector({
      outDir: stagingDir,
      runPrefix: 'graph-relations-out',
      compare: compareEdgesOut,
      maxBufferBytes: spillBufferBytes,
      scheduleIo
    });
    const inCollector = createRowSpillCollector({
      outDir: stagingDir,
      runPrefix: 'graph-relations-in',
      compare: compareEdgesIn,
      maxBufferBytes: spillBufferBytes,
      scheduleIo
    });

    const edgeCountsRaw = Object.create(null);
    const appendEdge = async (guard, edge, context) => {
      if (!edge?.s || !edge?.t) return;
      if (guard?.disabled && guard.reason === 'maxEdges') {
        guard.droppedEdges += 1;
        recordGraphSample(guard, context);
        return;
      }
      if (Number.isFinite(guard?.maxEdges) && guard.maxEdges >= 0) {
        // guard.maxEdges=0 means no edges, but we still want nodes.
        if (guard.maxEdges === 0) {
          guard.disabled = true;
          guard.reason = 'maxEdges';
          guard.cap = 'maxEdges';
          guard.droppedEdges += 1;
          recordGraphSample(guard, context);
          return;
        }
        const label = guard?.label;
        const current = label ? (edgeCountsRaw[label] || 0) : 0;
        if (label && current >= guard.maxEdges) {
          guard.disabled = true;
          guard.reason = 'maxEdges';
          guard.cap = 'maxEdges';
          guard.droppedEdges += 1;
          recordGraphSample(guard, context);
          return;
        }
      }
      const dedupeParts = [edge.g, edge.s, edge.t];
      const dedupeHash = hashTokenId64Parts(dedupeParts, EDGE_DEDUPE_HASH_SEED);
      const dedupeFingerprint = hashTokenId64Parts(dedupeParts, EDGE_DEDUPE_FINGERPRINT_SEED);
      await outCollector.append(edge, { dedupeHash, dedupeFingerprint });
      await inCollector.append(edge, { dedupeHash, dedupeFingerprint });
      if (guard?.label) edgeCountsRaw[guard.label] = (edgeCountsRaw[guard.label] || 0) + 1;
    };

    for (const chunk of chunks) {
      const sourceUid = normalizeChunkUid(chunk);
      if (!sourceUid) continue;
      const relations = chunk?.codeRelations || {};
      const chunkId = resolveChunkId(chunk) || null;
      const context = { file: chunk.file || null, chunkId, chunkUid: sourceUid };

      if (!callGuard.disabled && (!callNodes.allowed || callNodes.allowed.has(sourceUid))) {
        const callLinks = Array.isArray(relations.callLinks) ? relations.callLinks : [];
        for (const link of callLinks) {
          const targetUid = link?.to?.status === 'resolved' ? link.to.resolved?.chunkUid : null;
          if (!targetUid || !chunkByUid.has(targetUid)) continue;
          if (callNodes.allowed && !callNodes.allowed.has(targetUid)) continue;
          await appendEdge(callGuard, { g: 0, s: sourceUid, t: targetUid }, context);
          if (callGuard.disabled && callGuard.reason === 'maxEdges') break;
        }
      }

      if (!usageGuard.disabled && (!usageNodes.allowed || usageNodes.allowed.has(sourceUid))) {
        const usageLinks = Array.isArray(relations.usageLinks) ? relations.usageLinks : [];
        for (const link of usageLinks) {
          const targetUid = link?.to?.status === 'resolved' ? link.to.resolved?.chunkUid : null;
          if (!targetUid || !chunkByUid.has(targetUid)) continue;
          if (usageNodes.allowed && !usageNodes.allowed.has(targetUid)) continue;
          await appendEdge(usageGuard, { g: 1, s: sourceUid, t: targetUid }, context);
          if (usageGuard.disabled && usageGuard.reason === 'maxEdges') break;
        }
      }

      if (!useCallSites && !callGuard.disabled && (!callNodes.allowed || callNodes.allowed.has(sourceUid))) {
        const callDetails = Array.isArray(relations.callDetails) ? relations.callDetails : [];
        for (const detail of callDetails) {
          const targetUid = detail?.targetChunkUid;
          if (!targetUid || !chunkByUid.has(targetUid)) continue;
          if (callNodes.allowed && !callNodes.allowed.has(targetUid)) continue;
          await appendEdge(callGuard, { g: 0, s: sourceUid, t: targetUid }, context);
          if (callGuard.disabled && callGuard.reason === 'maxEdges') break;
        }
      }
    }

    if (useCallSites && !callGuard.disabled) {
      for (const site of callSites) {
        const sourceUid = site?.callerChunkUid;
        const targetUid = site?.targetChunkUid;
        if (!sourceUid || !targetUid) continue;
        if (!chunkByUid.has(sourceUid) || !chunkByUid.has(targetUid)) continue;
        if (callNodes.allowed && (!callNodes.allowed.has(sourceUid) || !callNodes.allowed.has(targetUid))) continue;
        const sourceChunk = chunkByUid.get(sourceUid) || null;
        const context = {
          file: sourceChunk?.file || null,
          chunkId: resolveChunkId(sourceChunk) || null,
          chunkUid: sourceUid
        };
        await appendEdge(callGuard, { g: 0, s: sourceUid, t: targetUid }, context);
        if (callGuard.disabled && callGuard.reason === 'maxEdges') break;
      }
    }

    const importNodesSet = new Set();
    if (fileRelations && typeof fileRelations.entries === 'function') {
      for (const [file, relations] of fileRelations.entries()) {
        if (!file) continue;
        if (fileSet.size && !fileSet.has(file)) continue;
        importNodesSet.add(file);
        let imports = Array.isArray(relations?.importLinks) ? relations.importLinks : [];
        if (!imports.length && Array.isArray(relations?.imports) && fileSet.size) {
          imports = relations.imports
            .map((spec) => resolveRelativeImport(file, spec, fileSet))
            .filter(Boolean);
        }
        for (const target of imports) {
          if (!target) continue;
          if (fileSet.size && !fileSet.has(target)) continue;
          importNodesSet.add(target);
        }
      }
    }
    const sortedImportNodes = stableOrder(Array.from(importNodesSet), [(value) => value]);
    const importNodes = applyNodeCap(importGuard, sortedImportNodes);

    if (!importGuard.disabled && fileRelations && typeof fileRelations.entries === 'function') {
      for (const [file, relations] of fileRelations.entries()) {
        if (!file) continue;
        if (fileSet.size && !fileSet.has(file)) continue;
        if (importNodes.allowed && !importNodes.allowed.has(file)) continue;
        let imports = Array.isArray(relations?.importLinks) ? relations.importLinks : [];
        if (!imports.length && Array.isArray(relations?.imports) && fileSet.size) {
          imports = relations.imports
            .map((spec) => resolveRelativeImport(file, spec, fileSet))
            .filter(Boolean);
        }
        const context = { file, chunkId: null, chunkUid: null };
        for (const target of imports) {
          if (!target) continue;
          if (fileSet.size && !fileSet.has(target)) continue;
          if (importNodes.allowed && !importNodes.allowed.has(target)) continue;
          await appendEdge(importGuard, { g: 2, s: file, t: target }, context);
          if (importGuard.disabled && importGuard.reason === 'maxEdges') break;
        }
        if (importGuard.disabled && importGuard.reason === 'maxEdges') break;
      }
    }

    const outSpill = await outCollector.finalize();
    const inSpill = await inCollector.finalize();

    const capsPayload = {
      callGraph: callGuard.reason ? callGuard : null,
      usageGraph: usageGuard.reason ? usageGuard : null,
      importGraph: importGuard.reason ? importGuard : null
    };
    maybeLogCaps(capsPayload, log);

    const byteCap = resolveByteCap(byteBudget);
    const byteCapStats = byteCap ? { droppedRows: 0, droppedByGraph: {}, byteBudget: byteCap } : null;
    const orderingHasher = createOrderingHasher();
    let maxRowBytes = 0;
    const edgeCounts = [0, 0, 0];

    const outGroups = groupNeighbors(
      iterateEdges(outSpill, { compare: compareEdgesOut }),
      { key: (edge) => edge.s, neighbor: (edge) => edge.t }
    )[Symbol.asyncIterator]();
    const inGroups = groupNeighbors(
      iterateEdges(inSpill, { compare: compareEdgesIn }),
      { key: (edge) => edge.t, neighbor: (edge) => edge.s }
    )[Symbol.asyncIterator]();

    let nextOut = await outGroups.next();
    let nextIn = await inGroups.next();

    const nodeLists = [callNodes.ids, usageNodes.ids, importNodes.ids];

    const rows = (async function* () {
      let totalBytes = 0;
      for (let g = 0; g < GRAPH_RELATION_GRAPHS.length; g += 1) {
        const graphName = GRAPH_RELATION_GRAPHS[g];
        const ids = nodeLists[g] || [];
        for (const id of ids) {
          let out = [];
          while (!nextOut.done && (nextOut.value.g < g || (nextOut.value.g === g && String(nextOut.value.id) < String(id)))) {
            nextOut = await outGroups.next();
          }
          if (!nextOut.done && nextOut.value.g === g && nextOut.value.id === id) {
            out = nextOut.value.neighbors;
            edgeCounts[g] += out.length;
            nextOut = await outGroups.next();
          }
          let incoming = [];
          while (!nextIn.done && (nextIn.value.g < g || (nextIn.value.g === g && String(nextIn.value.id) < String(id)))) {
            nextIn = await inGroups.next();
          }
          if (!nextIn.done && nextIn.value.g === g && nextIn.value.id === id) {
            incoming = nextIn.value.neighbors;
            nextIn = await inGroups.next();
          }

          const node = g === 2
            ? { id, file: id, out, in: incoming }
            : (() => {
              const chunk = chunkByUid.get(id) || null;
              const attrs = chunk ? buildChunkNodeAttrs(chunk) : {};
              return { id, ...attrs, out, in: incoming };
            })();

          const row = { graph: graphName, node };
          const line = JSON.stringify(row);
          const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
          maxRowBytes = Math.max(maxRowBytes, lineBytes);
          if (byteCap) {
            if (totalBytes + lineBytes > byteCap) {
              if (byteCapStats) {
                if (!byteCapStats.truncated) byteCapStats.truncated = true;
                byteCapStats.droppedRows += 1;
                byteCapStats.droppedByGraph = byteCapStats.droppedByGraph || {};
                byteCapStats.droppedByGraph[graphName] = (byteCapStats.droppedByGraph[graphName] || 0) + 1;
              }
              continue;
            }
            totalBytes += lineBytes;
          }
          orderingHasher.update(line);
          yield row;
        }
      }
    })();

    // Preserve existing artifacts until new outputs are fully written.
    // Strict consumers must be manifest-first; non-strict filesystem discovery may see legacy variants.

    const result = await schedule(() => writeJsonLinesShardedAsync({
      dir: outDir,
      partsDirName: 'graph_relations.parts',
      partPrefix: 'graph_relations.part-',
      items: rows,
      maxBytes: maxJsonBytes,
      atomic: true,
      offsets: offsetsConfig
    }));

    const parts = result.parts.map((part, index) => ({
      path: part,
      records: result.counts[index] || 0,
      bytes: result.bytes[index] || 0
    }));
    const offsetsMeta = createOffsetsMeta({
      suffix: offsetsConfig.suffix,
      parts: result.offsets,
      compression: 'none'
    });

    await schedule(() => writeJsonObjectFile(graphMetaPath, {
      fields: {
        schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
        artifact: 'graph_relations',
        format: 'jsonl-sharded',
        generatedAt,
        compression: 'none',
        totalRecords: result.total,
        totalBytes: result.totalBytes,
        maxPartRecords: result.maxPartRecords,
        maxPartBytes: result.maxPartBytes,
        targetMaxBytes: result.targetMaxBytes,
        parts,
        extensions: {
          graphs: {
            callGraph: { nodeCount: callNodes.ids.length, edgeCount: edgeCounts[0] },
            usageGraph: { nodeCount: usageNodes.ids.length, edgeCount: edgeCounts[1] },
            importGraph: { nodeCount: importNodes.ids.length, edgeCount: edgeCounts[2] }
          },
          caps: capsPayload,
          version: GRAPH_RELATION_VERSION,
          spill: {
            out: outSpill?.stats
              ? {
                runsSpilled: outSpill.stats.runsSpilled || 0,
                spillBytes: outSpill.stats.spillBytes || 0,
                dedupedRows: outSpill.stats.dedupedRows || 0,
                dedupeCollisions: outSpill.stats.dedupeCollisions || 0
              }
              : null,
            in: inSpill?.stats
              ? {
                runsSpilled: inSpill.stats.runsSpilled || 0,
                spillBytes: inSpill.stats.spillBytes || 0,
                dedupedRows: inSpill.stats.dedupedRows || 0,
                dedupeCollisions: inSpill.stats.dedupeCollisions || 0
              }
              : null
          },
          ...(byteCapStats ? { byteCaps: byteCapStats } : {}),
          ...(offsetsMeta ? { offsets: offsetsMeta } : {}),
          ...(Number.isFinite(maxRowBytes) ? { maxRowBytes } : {})
        }
      },
      atomic: true
    }));

    for (let i = 0; i < result.parts.length; i += 1) {
      const relPath = result.parts[i];
      const absPath = path.join(outDir, fromPosix(relPath));
      addPieceFile({
        type: 'relations',
        name: 'graph_relations',
        format: 'jsonl',
        count: result.counts[i] || 0
      }, absPath);
    }
    if (Array.isArray(result.offsets)) {
      for (let i = 0; i < result.offsets.length; i += 1) {
        const relPath = result.offsets[i];
        if (!relPath) continue;
        const absPath = path.join(outDir, fromPosix(relPath));
        addPieceFile({
          type: 'relations',
          name: 'graph_relations_offsets',
          format: 'bin',
          count: result.counts[i] || 0
        }, absPath);
      }
    }
    addPieceFile({ type: 'relations', name: 'graph_relations_meta', format: 'json' }, graphMetaPath);

    const orderingResult = orderingHasher.digest();
    const orderingCount = orderingResult?.count || 0;
    const orderingHash = orderingCount ? (orderingResult?.hash || null) : null;

    applyByteBudget({
      budget: byteBudget,
      totalBytes: result.totalBytes,
      label: 'graph_relations',
      stageCheckpoints,
      logger: log
    });

    await outSpill.cleanup();
    await inSpill.cleanup();
    await schedule(() => fs.rm(stagingDir, { recursive: true, force: true }));

    return { orderingHash, orderingCount };
  }

  const graphMeasurement = measureGraphRelations(graphRelations, { maxJsonBytes });
  if (!graphMeasurement) return;
  const orderingHash = graphMeasurement.orderingHash || null;
  const orderingCount = graphMeasurement.orderingCount || 0;
  const graphPath = path.join(outDir, 'graph_relations.json');
  const graphJsonlPath = path.join(outDir, 'graph_relations.jsonl');
  const graphMetaPath = path.join(outDir, 'graph_relations.meta.json');
  const graphPartsDir = path.join(outDir, 'graph_relations.parts');
  const offsetsConfig = { suffix: 'offsets.bin' };
  const csrPath = path.join(outDir, 'graph_relations.csr.json');
  const useGraphJsonl = maxJsonBytes && graphMeasurement.totalJsonBytes > maxJsonBytes;
  const budgetBytes = useGraphJsonl ? graphMeasurement.totalJsonlBytes : graphMeasurement.totalJsonBytes;
  applyByteBudget({
    budget: byteBudget,
    totalBytes: budgetBytes,
    label: 'graph_relations',
    stageCheckpoints,
    logger: log
  });
  if (!useGraphJsonl) {
    enqueueWrite(
      formatArtifactLabel(graphPath),
      async () => {
        const payload = materializeGraphRelationsPayload(graphRelations);
        await writeJsonObjectFile(graphPath, { fields: payload, atomic: true });
      }
    );
    addPieceFile({ type: 'relations', name: 'graph_relations', format: 'json' }, graphPath);
  } else {
    log(
      `graph_relations ~${Math.round(graphMeasurement.totalJsonlBytes / 1024)}KB; ` +
      'writing JSONL shards.'
    );
    enqueueWrite(
      formatArtifactLabel(graphMetaPath),
      async () => {
        const byteBudget = Number.isFinite(graphRelations?.caps?.maxBytes)
          ? Math.max(0, Math.floor(Number(graphRelations.caps.maxBytes)))
          : null;
        const capStats = byteBudget ? { droppedRows: 0, droppedByGraph: {}, byteBudget } : null;
        const result = await writeJsonLinesSharded({
          dir: outDir,
          partsDirName: 'graph_relations.parts',
          partPrefix: 'graph_relations.part-',
          items: createGraphRelationsIterator(graphRelations, { byteBudget, stats: capStats })(),
          maxBytes: maxJsonBytes,
          atomic: true,
          offsets: offsetsConfig
        });
        const parts = result.parts.map((part, index) => ({
          path: part,
          records: result.counts[index] || 0,
          bytes: result.bytes[index] || 0
        }));
        const offsetsMeta = createOffsetsMeta({
          suffix: offsetsConfig.suffix,
          parts: result.offsets,
          compression: 'none'
        });
        await writeJsonObjectFile(graphMetaPath, {
          fields: {
            schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
            artifact: 'graph_relations',
            format: 'jsonl-sharded',
            generatedAt: graphMeasurement.generatedAt,
            compression: 'none',
            totalRecords: result.total,
            totalBytes: result.totalBytes,
            maxPartRecords: result.maxPartRecords,
            maxPartBytes: result.maxPartBytes,
            targetMaxBytes: result.targetMaxBytes,
            parts,
            extensions: {
              graphs: graphMeasurement.graphs,
              caps: graphRelations.caps ?? null,
              version: graphMeasurement.version,
              ...(capStats ? { byteCaps: capStats } : {}),
              ...(offsetsMeta ? { offsets: offsetsMeta } : {})
            }
          },
          atomic: true
        });
        for (let i = 0; i < result.parts.length; i += 1) {
          const relPath = result.parts[i];
          const absPath = path.join(outDir, fromPosix(relPath));
          addPieceFile({
            type: 'relations',
            name: 'graph_relations',
            format: 'jsonl',
            count: result.counts[i] || 0
          }, absPath);
        }
        if (Array.isArray(result.offsets)) {
          for (let i = 0; i < result.offsets.length; i += 1) {
            const relPath = result.offsets[i];
            if (!relPath) continue;
            const absPath = path.join(outDir, fromPosix(relPath));
            addPieceFile({
              type: 'relations',
              name: 'graph_relations_offsets',
              format: 'bin',
              count: result.counts[i] || 0
            }, absPath);
          }
        }
        addPieceFile({ type: 'relations', name: 'graph_relations_meta', format: 'json' }, graphMetaPath);
        const csrPayload = buildGraphRelationsCsr(graphRelations);
        if (csrPayload) {
          await writeJsonObjectFile(csrPath, { fields: csrPayload, atomic: true });
          addPieceFile({ type: 'relations', name: 'graph_relations_csr', format: 'json' }, csrPath);
        }
      }
    );
  }
  return { orderingHash, orderingCount };
}
