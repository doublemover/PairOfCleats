import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { acquireIndexLock } from '../build/lock.js';
import { resolveIndexRef } from '../index-ref.js';
import { getRepoCacheRoot } from '../../shared/dict-utils.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { sha1 } from '../../shared/hash.js';
import { stableStringify } from '../../shared/stable-json.js';
import { loadChunkMeta, loadJsonArrayArtifact, loadPiecesManifest } from '../../shared/artifact-io.js';
import { atomicWriteText } from '../../shared/io/atomic-write.js';
import {
  loadDiffInputs,
  loadDiffSummary,
  loadDiffsManifest,
  writeDiffInputs,
  writeDiffSummary,
  writeDiffsManifest
} from './registry.js';

const MODE_ORDER = ['code', 'prose', 'extracted-prose', 'records'];
const EVENT_ORDER = {
  'file.added': 1,
  'file.removed': 2,
  'file.modified': 3,
  'file.renamed': 4,
  'chunk.added': 5,
  'chunk.removed': 6,
  'chunk.modified': 7,
  'chunk.moved': 8,
  'relation.added': 9,
  'relation.removed': 10,
  'limits.chunkDiffSkipped': 11
};
const DIFF_ID_RE = /^diff_[A-Za-z0-9._-]+$/;
const DEFAULT_MAX_CHANGED_FILES = 200;
const DEFAULT_MAX_CHUNKS_PER_FILE = 500;
const DEFAULT_MAX_EVENTS = 20000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_DIFFS = 50;
const DEFAULT_RETAIN_DAYS = 30;

const invalidRequest = (message, details = null) => createError(ERROR_CODES.INVALID_REQUEST, message, details);
const notFound = (message, details = null) => createError(ERROR_CODES.NOT_FOUND, message, details);
const queueError = (message, details = null) => createError(ERROR_CODES.QUEUE_OVERLOADED, message, details);
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const parseCreatedAtMs = (value) => {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
};

const ensureDiffId = (diffId) => {
  if (typeof diffId !== 'string' || !DIFF_ID_RE.test(diffId)) {
    throw invalidRequest(`Invalid diff id "${diffId}".`);
  }
};

const withDiffLock = async (repoCacheRoot, options, worker) => {
  const lock = await acquireIndexLock({
    repoCacheRoot,
    waitMs: Number.isFinite(options?.waitMs) ? Number(options.waitMs) : 0,
    pollMs: Number.isFinite(options?.pollMs) ? Number(options.pollMs) : 1000,
    staleMs: Number.isFinite(options?.staleMs) ? Number(options.staleMs) : undefined,
    log: typeof options?.log === 'function' ? options.log : () => {}
  });
  if (!lock) {
    throw queueError('Index lock held; unable to mutate diffs.');
  }
  try {
    return await worker(lock);
  } finally {
    await lock.release();
  }
};

const normalizeModes = (input) => {
  const raw = Array.isArray(input)
    ? input
    : String(input || '')
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter(Boolean);
  const selected = [];
  for (const token of raw) {
    const mode = String(token || '').trim().toLowerCase();
    if (!mode) continue;
    if (!MODE_ORDER.includes(mode)) {
      throw invalidRequest(`Invalid mode "${mode}". Use ${MODE_ORDER.join('|')}.`);
    }
    if (!selected.includes(mode)) selected.push(mode);
  }
  return selected.length ? selected : ['code'];
};

const normalizePositiveInt = (value, fallback) => {
  if (!Number.isFinite(Number(value))) return fallback;
  return Math.max(1, Math.floor(Number(value)));
};

const modeRank = (mode) => {
  const index = MODE_ORDER.indexOf(mode);
  return index === -1 ? MODE_ORDER.length : index;
};

const getFileHash = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.hash === 'string' && entry.hash) return entry.hash;
  if (typeof entry.fileHash === 'string' && entry.fileHash) return entry.fileHash;
  return null;
};

const getFileSize = (entry) => (
  Number.isFinite(Number(entry?.size)) ? Number(entry.size) : null
);

const normalizeFileMetaEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const file = typeof entry.file === 'string' ? entry.file : null;
  if (!file) return null;
  return {
    id: Number.isFinite(Number(entry.id)) ? Number(entry.id) : null,
    file,
    hash: getFileHash(entry),
    size: getFileSize(entry),
    ext: typeof entry.ext === 'string' ? entry.ext : null
  };
};

const chunkLogicalKey = (chunk) => {
  const metaV2 = isObject(chunk?.metaV2) ? chunk.metaV2 : null;
  const signature = (
    (typeof metaV2?.signature === 'string' && metaV2.signature)
    || (typeof chunk?.docmeta?.signature === 'string' ? chunk.docmeta.signature : '')
  );
  const segmentId = typeof chunk?.segment?.segmentId === 'string'
    ? chunk.segment.segmentId
    : '';
  const kind = typeof chunk?.kind === 'string' ? chunk.kind : '';
  const name = typeof chunk?.name === 'string' ? chunk.name : '';
  return `${segmentId}|${kind}|${name}|${signature}`;
};

const chunkSignature = (chunk) => {
  const metaV2 = isObject(chunk?.metaV2) ? chunk.metaV2 : null;
  const payload = {
    kind: chunk?.kind || null,
    name: chunk?.name || null,
    signature: metaV2?.signature || chunk?.docmeta?.signature || null,
    modifiers: metaV2?.modifiers || null,
    params: metaV2?.params || null
  };
  return sha1(stableStringify(payload));
};

const chunkRangeKey = (chunk) => {
  const start = Number.isFinite(Number(chunk?.start)) ? Number(chunk.start) : -1;
  const end = Number.isFinite(Number(chunk?.end)) ? Number(chunk.end) : -1;
  const startLine = Number.isFinite(Number(chunk?.startLine)) ? Number(chunk.startLine) : -1;
  const endLine = Number.isFinite(Number(chunk?.endLine)) ? Number(chunk.endLine) : -1;
  return `${startLine}:${endLine}:${start}:${end}`;
};

const chunkStableKey = (chunk) => {
  const chunkId = (
    chunk?.metaV2?.chunkId
    || chunk?.chunkId
    || (Number.isFinite(Number(chunk?.id)) ? `id:${Number(chunk.id)}` : null)
    || ''
  );
  return `${chunkId}|${chunkRangeKey(chunk)}|${chunkLogicalKey(chunk)}`;
};

const normalizeChunk = (chunk) => {
  if (!chunk || typeof chunk !== 'object') return null;
  const file = typeof chunk.file === 'string' ? chunk.file : null;
  if (!file) return null;
  const chunkId = (
    chunk?.metaV2?.chunkId
    || chunk?.chunkId
    || (Number.isFinite(Number(chunk?.id)) ? `id:${Number(chunk.id)}` : null)
  );
  return {
    file,
    chunkId,
    logicalKey: chunkLogicalKey(chunk),
    signature: chunkSignature(chunk),
    rangeKey: chunkRangeKey(chunk),
    start: Number.isFinite(Number(chunk.start)) ? Number(chunk.start) : null,
    end: Number.isFinite(Number(chunk.end)) ? Number(chunk.end) : null,
    startLine: Number.isFinite(Number(chunk.startLine)) ? Number(chunk.startLine) : null,
    endLine: Number.isFinite(Number(chunk.endLine)) ? Number(chunk.endLine) : null,
    raw: chunk
  };
};

const sortChunks = (chunks) => (
  [...chunks].sort((left, right) => chunkStableKey(left.raw).localeCompare(chunkStableKey(right.raw)))
);

const loadFileMetaByPath = async (indexDir) => {
  const rows = await loadJsonArrayArtifact(indexDir, 'file_meta', { strict: false });
  const byPath = new Map();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const normalized = normalizeFileMetaEntry(row);
      if (!normalized) continue;
      byPath.set(normalized.file, normalized);
    }
  }
  if (byPath.size) return byPath;

  const chunkMeta = await loadChunkMeta(indexDir, { strict: false });
  for (const chunk of Array.isArray(chunkMeta) ? chunkMeta : []) {
    const file = typeof chunk?.file === 'string' ? chunk.file : null;
    if (!file || byPath.has(file)) continue;
    byPath.set(file, {
      id: Number.isFinite(Number(chunk?.fileId)) ? Number(chunk.fileId) : null,
      file,
      hash: chunk?.fileHash || null,
      size: Number.isFinite(Number(chunk?.fileSize)) ? Number(chunk.fileSize) : null,
      ext: chunk?.ext || null
    });
  }
  return byPath;
};

const piecesFingerprint = (indexDir) => {
  const manifest = loadPiecesManifest(indexDir, { strict: false });
  if (!isObject(manifest)) return null;
  const pieces = Array.isArray(manifest.pieces) ? manifest.pieces : [];
  return stableStringify({
    artifactSurfaceVersion: manifest.artifactSurfaceVersion || null,
    compatibilityKey: manifest.compatibilityKey || null,
    pieces
  });
};

const buildDiffEndpoint = ({ resolved, modes }) => {
  const endpoint = { ref: resolved.canonical };
  if (resolved.identity?.snapshotId) endpoint.snapshotId = resolved.identity.snapshotId;
  const buildIds = modes
    .map((mode) => resolved.identity?.buildIdByMode?.[mode])
    .filter((value) => typeof value === 'string' && value);
  const uniqueBuildIds = [...new Set(buildIds)];
  if (uniqueBuildIds.length === 1) endpoint.buildId = uniqueBuildIds[0];
  if (resolved.parsed?.kind === 'path') endpoint.indexRootRef = resolved.parsed.canonical;
  return endpoint;
};

const compareCompat = ({ fromResolved, toResolved, modes }) => {
  const configMismatches = [];
  const toolMismatches = [];
  for (const mode of modes) {
    const fromConfig = fromResolved.identity?.configHashByMode?.[mode] ?? null;
    const toConfig = toResolved.identity?.configHashByMode?.[mode] ?? null;
    if (fromConfig && toConfig && fromConfig !== toConfig) {
      configMismatches.push({ mode, from: fromConfig, to: toConfig });
    }
    const fromTool = fromResolved.identity?.toolVersionByMode?.[mode] ?? null;
    const toTool = toResolved.identity?.toolVersionByMode?.[mode] ?? null;
    if (fromTool && toTool && fromTool !== toTool) {
      toolMismatches.push({ mode, from: fromTool, to: toTool });
    }
  }
  return {
    configHashMismatch: configMismatches.length > 0,
    toolVersionMismatch: toolMismatches.length > 0,
    configMismatches,
    toolMismatches
  };
};

const sortedPaths = (iterable) => [...iterable].sort((a, b) => a.localeCompare(b));

const buildRelationSet = (chunk) => {
  const codeRelations = isObject(chunk?.raw?.codeRelations) ? chunk.raw.codeRelations : null;
  if (!codeRelations) return new Set();
  const keys = [];
  const appendList = (prefix, list) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const to = entry.to || entry.target || entry.file || entry.symbol || '';
      const type = entry.type || '';
      keys.push(`${prefix}|${to}|${type}`);
    }
  };
  appendList('imports', codeRelations.imports);
  appendList('calls', codeRelations.calls);
  appendList('usage', codeRelations.usageLinks);
  keys.sort((a, b) => a.localeCompare(b));
  return new Set(keys);
};

const diffChunksForFile = ({
  mode,
  file,
  beforeFile,
  afterFile,
  beforeChunks,
  afterChunks,
  includeRelations,
  maxChunksPerFile
}) => {
  const events = [];
  if (beforeChunks.length > maxChunksPerFile || afterChunks.length > maxChunksPerFile) {
    events.push({
      kind: 'limits.chunkDiffSkipped',
      mode,
      file,
      reason: 'max-chunks-per-file',
      beforeChunks: beforeChunks.length,
      afterChunks: afterChunks.length,
      maxChunksPerFile
    });
    return events;
  }

  const beforeSorted = sortChunks(beforeChunks);
  const afterSorted = sortChunks(afterChunks);
  const usedAfterIndexes = new Set();
  const matched = [];
  const unmatchedBefore = [];
  const unmatchedAfter = [];

  const afterByChunkId = new Map();
  for (let i = 0; i < afterSorted.length; i += 1) {
    const chunk = afterSorted[i];
    if (!chunk.chunkId) continue;
    const list = afterByChunkId.get(chunk.chunkId) || [];
    list.push(i);
    afterByChunkId.set(chunk.chunkId, list);
  }

  for (const beforeChunk of beforeSorted) {
    if (!beforeChunk.chunkId) {
      unmatchedBefore.push(beforeChunk);
      continue;
    }
    const indexes = afterByChunkId.get(beforeChunk.chunkId) || [];
    const index = indexes.find((candidate) => !usedAfterIndexes.has(candidate));
    if (index == null) {
      unmatchedBefore.push(beforeChunk);
      continue;
    }
    usedAfterIndexes.add(index);
    matched.push([beforeChunk, afterSorted[index]]);
  }

  for (let i = 0; i < afterSorted.length; i += 1) {
    if (usedAfterIndexes.has(i)) continue;
    unmatchedAfter.push(afterSorted[i]);
  }

  const byLogical = (chunks) => {
    const map = new Map();
    for (const chunk of chunks) {
      const list = map.get(chunk.logicalKey) || [];
      list.push(chunk);
      map.set(chunk.logicalKey, list);
    }
    for (const list of map.values()) {
      list.sort((left, right) => left.rangeKey.localeCompare(right.rangeKey));
    }
    return map;
  };

  const beforeLogical = byLogical(unmatchedBefore);
  const afterLogical = byLogical(unmatchedAfter);
  const stillBefore = [];
  const stillAfter = [];
  const logicalKeys = sortedPaths(new Set([
    ...beforeLogical.keys(),
    ...afterLogical.keys()
  ]));
  for (const logicalKey of logicalKeys) {
    const left = beforeLogical.get(logicalKey) || [];
    const right = afterLogical.get(logicalKey) || [];
    const pairs = Math.min(left.length, right.length);
    for (let i = 0; i < pairs; i += 1) {
      matched.push([left[i], right[i]]);
    }
    for (let i = pairs; i < left.length; i += 1) stillBefore.push(left[i]);
    for (let i = pairs; i < right.length; i += 1) stillAfter.push(right[i]);
  }

  for (const [beforeChunk, afterChunk] of matched) {
    const rangeChanged = beforeChunk.rangeKey !== afterChunk.rangeKey;
    const semanticChanged = beforeChunk.signature !== afterChunk.signature;
    if (semanticChanged) {
      events.push({
        kind: 'chunk.modified',
        mode,
        file,
        beforeFile,
        afterFile,
        chunkId: beforeChunk.chunkId || afterChunk.chunkId || null,
        logicalKey: beforeChunk.logicalKey,
        before: {
          range: beforeChunk.rangeKey,
          signature: beforeChunk.signature
        },
        after: {
          range: afterChunk.rangeKey,
          signature: afterChunk.signature
        }
      });
    } else if (rangeChanged) {
      events.push({
        kind: 'chunk.moved',
        mode,
        file,
        beforeFile,
        afterFile,
        chunkId: beforeChunk.chunkId || afterChunk.chunkId || null,
        logicalKey: beforeChunk.logicalKey,
        beforeRange: beforeChunk.rangeKey,
        afterRange: afterChunk.rangeKey
      });
    }
    if (includeRelations) {
      const beforeRelations = buildRelationSet(beforeChunk);
      const afterRelations = buildRelationSet(afterChunk);
      for (const key of sortedPaths(afterRelations).filter((key) => !beforeRelations.has(key))) {
        events.push({
          kind: 'relation.added',
          mode,
          file,
          beforeFile,
          afterFile,
          chunkId: afterChunk.chunkId || null,
          relationKey: key
        });
      }
      for (const key of sortedPaths(beforeRelations).filter((key) => !afterRelations.has(key))) {
        events.push({
          kind: 'relation.removed',
          mode,
          file,
          beforeFile,
          afterFile,
          chunkId: beforeChunk.chunkId || null,
          relationKey: key
        });
      }
    }
  }

  for (const chunk of stillBefore) {
    events.push({
      kind: 'chunk.removed',
      mode,
      file,
      beforeFile,
      afterFile,
      chunkId: chunk.chunkId || null,
      logicalKey: chunk.logicalKey
    });
  }

  for (const chunk of stillAfter) {
    events.push({
      kind: 'chunk.added',
      mode,
      file,
      beforeFile,
      afterFile,
      chunkId: chunk.chunkId || null,
      logicalKey: chunk.logicalKey
    });
  }

  return events;
};

const summarizeMode = (events, mode, chunkDiffSkipped = null) => {
  const modeEvents = events.filter((event) => event.mode === mode);
  const files = { added: 0, removed: 0, modified: 0, renamed: 0 };
  const chunks = { added: 0, removed: 0, modified: 0, moved: 0 };
  const relations = { edgesAdded: 0, edgesRemoved: 0 };
  for (const event of modeEvents) {
    if (event.kind === 'file.added') files.added += 1;
    if (event.kind === 'file.removed') files.removed += 1;
    if (event.kind === 'file.modified') files.modified += 1;
    if (event.kind === 'file.renamed') files.renamed += 1;
    if (event.kind === 'chunk.added') chunks.added += 1;
    if (event.kind === 'chunk.removed') chunks.removed += 1;
    if (event.kind === 'chunk.modified') chunks.modified += 1;
    if (event.kind === 'chunk.moved') chunks.moved += 1;
    if (event.kind === 'relation.added') relations.edgesAdded += 1;
    if (event.kind === 'relation.removed') relations.edgesRemoved += 1;
  }
  return {
    files,
    chunks,
    relations,
    limits: chunkDiffSkipped || { chunkDiffSkipped: false, reason: null }
  };
};

const eventSortKey = (event) => {
  const file = String(event.file || '');
  const chunkId = String(event.chunkId || '');
  const relationKey = String(event.relationKey || '');
  const logicalKey = String(event.logicalKey || '');
  const beforeFile = String(event.beforeFile || '');
  const afterFile = String(event.afterFile || '');
  return `${file}|${beforeFile}|${afterFile}|${chunkId}|${logicalKey}|${relationKey}`;
};

const sortEvents = (events) => (
  [...events].sort((left, right) => {
    const modeDelta = modeRank(left.mode) - modeRank(right.mode);
    if (modeDelta !== 0) return modeDelta;
    const typeDelta = (EVENT_ORDER[left.kind] || 999) - (EVENT_ORDER[right.kind] || 999);
    if (typeDelta !== 0) return typeDelta;
    return eventSortKey(left).localeCompare(eventSortKey(right));
  })
);

const applyEventBounds = (events, { maxEvents, maxBytes }) => {
  const bounded = [];
  let bytes = 0;
  let truncated = false;
  let reason = null;
  for (const event of events) {
    if (bounded.length >= maxEvents) {
      truncated = true;
      reason = 'max-events';
      break;
    }
    const lineBytes = Buffer.byteLength(`${JSON.stringify(event)}\n`, 'utf8');
    if (bytes + lineBytes > maxBytes) {
      truncated = true;
      reason = 'max-bytes';
      break;
    }
    bounded.push(event);
    bytes += lineBytes;
  }
  return { events: bounded, truncated, reason, bytes };
};

const toEventCounts = (events) => {
  const byKind = {};
  for (const event of events) {
    const kind = String(event.kind || 'unknown');
    byKind[kind] = Number(byKind[kind] || 0) + 1;
  }
  return byKind;
};

const sortDiffEntries = (entries) => (
  [...entries].sort((left, right) => {
    const leftMs = parseCreatedAtMs(left.createdAt);
    const rightMs = parseCreatedAtMs(right.createdAt);
    if (leftMs !== rightMs) return rightMs - leftMs;
    return String(left.id || '').localeCompare(String(right.id || ''));
  })
);

const writeEventsJsonl = async (repoCacheRoot, diffId, events) => {
  const eventsPath = path.join(repoCacheRoot, 'diffs', diffId, 'events.jsonl');
  const payload = events.map((entry) => JSON.stringify(entry)).join('\n');
  await atomicWriteText(eventsPath, payload.length ? `${payload}\n` : '', { newline: false });
  return eventsPath;
};

const hasPathRef = (parsed) => parsed?.kind === 'path';

const computeModeDiff = async ({
  mode,
  fromDir,
  toDir,
  detectRenames,
  includeRelations,
  maxChangedFiles,
  maxChunksPerFile
}) => {
  const events = [];
  const fromFingerprint = piecesFingerprint(fromDir);
  const toFingerprint = piecesFingerprint(toDir);
  if (fromFingerprint && toFingerprint && fromFingerprint === toFingerprint) {
    return {
      mode,
      events,
      summary: summarizeMode(events, mode),
      fastPath: true
    };
  }

  const fromFiles = await loadFileMetaByPath(fromDir);
  const toFiles = await loadFileMetaByPath(toDir);
  const fromPaths = new Set(fromFiles.keys());
  const toPaths = new Set(toFiles.keys());
  const added = sortedPaths([...toPaths].filter((file) => !fromPaths.has(file)));
  const removed = sortedPaths([...fromPaths].filter((file) => !toPaths.has(file)));
  const intersect = sortedPaths([...fromPaths].filter((file) => toPaths.has(file)));
  const modified = [];
  for (const file of intersect) {
    const before = fromFiles.get(file);
    const after = toFiles.get(file);
    const hashChanged = (before?.hash || null) !== (after?.hash || null);
    const sizeChanged = (before?.size || null) !== (after?.size || null);
    if (hashChanged || sizeChanged) modified.push(file);
  }

  const renamedPairs = [];
  if (detectRenames) {
    const removedByHash = new Map();
    const addedByHash = new Map();
    for (const file of removed) {
      const hash = fromFiles.get(file)?.hash;
      if (!hash) continue;
      const list = removedByHash.get(hash) || [];
      list.push(file);
      removedByHash.set(hash, list);
    }
    for (const file of added) {
      const hash = toFiles.get(file)?.hash;
      if (!hash) continue;
      const list = addedByHash.get(hash) || [];
      list.push(file);
      addedByHash.set(hash, list);
    }
    const hashes = sortedPaths(new Set([
      ...removedByHash.keys(),
      ...addedByHash.keys()
    ]));
    for (const hash of hashes) {
      const fromList = sortedPaths(removedByHash.get(hash) || []);
      const toList = sortedPaths(addedByHash.get(hash) || []);
      const pairs = Math.min(fromList.length, toList.length);
      for (let i = 0; i < pairs; i += 1) {
        renamedPairs.push({ beforeFile: fromList[i], afterFile: toList[i] });
      }
    }
  }
  const renamedBefore = new Set(renamedPairs.map((entry) => entry.beforeFile));
  const renamedAfter = new Set(renamedPairs.map((entry) => entry.afterFile));
  const addedFinal = added.filter((file) => !renamedAfter.has(file));
  const removedFinal = removed.filter((file) => !renamedBefore.has(file));

  for (const file of addedFinal) {
    events.push({
      kind: 'file.added',
      mode,
      file,
      after: toFiles.get(file)
    });
  }
  for (const file of removedFinal) {
    events.push({
      kind: 'file.removed',
      mode,
      file,
      before: fromFiles.get(file)
    });
  }
  for (const file of modified) {
    events.push({
      kind: 'file.modified',
      mode,
      file,
      before: fromFiles.get(file),
      after: toFiles.get(file)
    });
  }
  for (const pair of renamedPairs.sort((left, right) => (
    `${left.beforeFile}|${left.afterFile}`.localeCompare(`${right.beforeFile}|${right.afterFile}`)
  ))) {
    events.push({
      kind: 'file.renamed',
      mode,
      file: pair.afterFile,
      beforeFile: pair.beforeFile,
      afterFile: pair.afterFile,
      before: fromFiles.get(pair.beforeFile),
      after: toFiles.get(pair.afterFile)
    });
  }

  const changedFileSpecs = [
    ...modified.map((file) => ({ file, beforeFile: file, afterFile: file })),
    ...renamedPairs.map((entry) => ({
      file: entry.afterFile,
      beforeFile: entry.beforeFile,
      afterFile: entry.afterFile
    }))
  ].sort((left, right) => (
    `${left.beforeFile}|${left.afterFile}`.localeCompare(`${right.beforeFile}|${right.afterFile}`)
  ));

  let chunkDiffSkipped = { chunkDiffSkipped: false, reason: null };
  if (changedFileSpecs.length > maxChangedFiles) {
    chunkDiffSkipped = { chunkDiffSkipped: true, reason: 'max-changed-files' };
    events.push({
      kind: 'limits.chunkDiffSkipped',
      mode,
      reason: 'max-changed-files',
      changedFiles: changedFileSpecs.length,
      maxChangedFiles
    });
  } else if (changedFileSpecs.length) {
    const [fromChunkMeta, toChunkMeta] = await Promise.all([
      loadChunkMeta(fromDir, { strict: false }),
      loadChunkMeta(toDir, { strict: false })
    ]);
    const groupByFile = (chunks) => {
      const grouped = new Map();
      for (const rawChunk of Array.isArray(chunks) ? chunks : []) {
        const chunk = normalizeChunk(rawChunk);
        if (!chunk) continue;
        const list = grouped.get(chunk.file) || [];
        list.push(chunk);
        grouped.set(chunk.file, list);
      }
      return grouped;
    };
    const beforeByFile = groupByFile(fromChunkMeta);
    const afterByFile = groupByFile(toChunkMeta);
    for (const spec of changedFileSpecs) {
      const beforeChunks = beforeByFile.get(spec.beforeFile) || [];
      const afterChunks = afterByFile.get(spec.afterFile) || [];
      const chunkEvents = diffChunksForFile({
        mode,
        file: spec.file,
        beforeFile: spec.beforeFile,
        afterFile: spec.afterFile,
        beforeChunks,
        afterChunks,
        includeRelations,
        maxChunksPerFile
      });
      events.push(...chunkEvents);
    }
  }

  return {
    mode,
    events,
    summary: summarizeMode(events, mode, chunkDiffSkipped),
    fastPath: false
  };
};

const buildCompactConfigValue = (resolved, modes) => {
  const values = modes
    .map((mode) => resolved.identity?.configHashByMode?.[mode] ?? null)
    .filter((value) => value != null);
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : null;
};

const buildCompactToolValue = (resolved, modes) => {
  const values = modes
    .map((mode) => resolved.identity?.toolVersionByMode?.[mode] ?? null)
    .filter((value) => value != null);
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : null;
};

export const computeIndexDiff = async ({
  repoRoot,
  userConfig = null,
  from,
  to,
  modes = ['code'],
  detectRenames = true,
  includeRelations = true,
  maxChangedFiles = DEFAULT_MAX_CHANGED_FILES,
  maxChunksPerFile = DEFAULT_MAX_CHUNKS_PER_FILE,
  maxEvents = DEFAULT_MAX_EVENTS,
  maxBytes = DEFAULT_MAX_BYTES,
  allowMismatch = false,
  persist = true,
  persistUnsafe = false,
  waitMs = 0,
  dryRun = false
} = {}) => {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
    throw invalidRequest('repoRoot is required.');
  }
  const fromRef = typeof from === 'string' && from.trim() ? from.trim() : null;
  const toRef = typeof to === 'string' && to.trim() ? to.trim() : null;
  if (!fromRef || !toRef) {
    throw invalidRequest('Both --from and --to refs are required.');
  }

  const resolvedRepoRoot = path.resolve(repoRoot);
  const selectedModes = normalizeModes(modes)
    .sort((left, right) => modeRank(left) - modeRank(right));
  const resolvedFrom = resolveIndexRef({
    ref: fromRef,
    repoRoot: resolvedRepoRoot,
    userConfig,
    requestedModes: selectedModes,
    preferFrozen: true,
    allowMissingModes: false
  });
  const resolvedTo = resolveIndexRef({
    ref: toRef,
    repoRoot: resolvedRepoRoot,
    userConfig,
    requestedModes: selectedModes,
    preferFrozen: true,
    allowMissingModes: false
  });

  const compat = compareCompat({ fromResolved: resolvedFrom, toResolved: resolvedTo, modes: selectedModes });
  if (compat.configHashMismatch && allowMismatch !== true) {
    throw invalidRequest('configHash mismatch between --from and --to. Use --allow-mismatch to continue.');
  }

  const inputsCanonical = {
    version: 1,
    kind: 'semantic-v1',
    from: {
      ref: resolvedFrom.canonical,
      identityHash: resolvedFrom.identityHash,
      identity: resolvedFrom.identity
    },
    to: {
      ref: resolvedTo.canonical,
      identityHash: resolvedTo.identityHash,
      identity: resolvedTo.identity
    },
    modes: selectedModes,
    options: {
      detectRenames: detectRenames === true,
      includeRelations: includeRelations === true,
      maxChangedFiles: normalizePositiveInt(maxChangedFiles, DEFAULT_MAX_CHANGED_FILES),
      maxChunksPerFile: normalizePositiveInt(maxChunksPerFile, DEFAULT_MAX_CHUNKS_PER_FILE)
    }
  };
  const identityHash = sha1(stableStringify(inputsCanonical));
  const diffId = `diff_${identityHash.slice(0, 16)}`;
  ensureDiffId(diffId);
  const createdAt = new Date().toISOString();
  const fromEndpoint = buildDiffEndpoint({ resolved: resolvedFrom, modes: selectedModes });
  const toEndpoint = buildDiffEndpoint({ resolved: resolvedTo, modes: selectedModes });
  const maxEventsLimit = normalizePositiveInt(maxEvents, DEFAULT_MAX_EVENTS);
  const maxBytesLimit = normalizePositiveInt(maxBytes, DEFAULT_MAX_BYTES);

  const modeResults = [];
  for (const mode of selectedModes) {
    const fromDir = resolvedFrom.indexDirByMode?.[mode];
    const toDir = resolvedTo.indexDirByMode?.[mode];
    if (!fromDir || !toDir) {
      throw notFound(`Missing resolved mode roots for ${mode}.`);
    }
    modeResults.push(await computeModeDiff({
      mode,
      fromDir,
      toDir,
      detectRenames: detectRenames === true,
      includeRelations: includeRelations === true,
      maxChangedFiles: normalizePositiveInt(maxChangedFiles, DEFAULT_MAX_CHANGED_FILES),
      maxChunksPerFile: normalizePositiveInt(maxChunksPerFile, DEFAULT_MAX_CHUNKS_PER_FILE)
    }));
  }

  const allEventsSorted = sortEvents(modeResults.flatMap((entry) => entry.events));
  const bounded = applyEventBounds(allEventsSorted, {
    maxEvents: maxEventsLimit,
    maxBytes: maxBytesLimit
  });
  const modesSummary = Object.fromEntries(modeResults.map((entry) => [entry.mode, entry.summary]));
  const summary = {
    id: diffId,
    createdAt,
    from: fromEndpoint,
    to: toEndpoint,
    modes: selectedModes,
    orderingSchema: 'diff-events-v1',
    truncated: bounded.truncated,
    limits: {
      maxEvents: maxEventsLimit,
      maxBytes: maxBytesLimit,
      reason: bounded.reason
    },
    totals: {
      allEvents: allEventsSorted.length,
      emittedEvents: bounded.events.length,
      byKind: toEventCounts(allEventsSorted)
    },
    modesSummary,
    compat
  };
  const inputs = {
    id: diffId,
    createdAt,
    from: fromEndpoint,
    to: toEndpoint,
    modes: selectedModes,
    allowMismatch: allowMismatch === true,
    identityHash,
    fromConfigHash: buildCompactConfigValue(resolvedFrom, selectedModes),
    toConfigHash: buildCompactConfigValue(resolvedTo, selectedModes),
    fromToolVersion: buildCompactToolValue(resolvedFrom, selectedModes),
    toToolVersion: buildCompactToolValue(resolvedTo, selectedModes),
    options: inputsCanonical.options
  };

  const hasPathInputs = hasPathRef(resolvedFrom.parsed) || hasPathRef(resolvedTo.parsed);
  const persistEnabled = persist !== false && dryRun !== true && !(hasPathInputs && persistUnsafe !== true);
  const repoCacheRoot = getRepoCacheRoot(resolvedRepoRoot, userConfig);

  if (!persistEnabled) {
    return {
      diffId,
      createdAt,
      persisted: false,
      inputs,
      summary,
      events: bounded.events,
      pathRefNotPersisted: hasPathInputs && persistUnsafe !== true
    };
  }

  return withDiffLock(repoCacheRoot, { waitMs }, async (lock) => {
    const manifest = loadDiffsManifest(repoCacheRoot);
    const existingEntry = manifest.diffs?.[diffId];
    if (existingEntry) {
      const existingInputs = loadDiffInputs(repoCacheRoot, diffId);
      if (existingInputs?.identityHash === identityHash) {
        return {
          diffId,
          createdAt: existingEntry.createdAt || createdAt,
          persisted: true,
          reused: true,
          inputs: existingInputs,
          summary: loadDiffSummary(repoCacheRoot, diffId),
          eventsPath: existingEntry.eventsPath || null
        };
      }
      throw createError(ERROR_CODES.INTERNAL, `diffId collision for ${diffId}.`);
    }

    await writeDiffInputs(repoCacheRoot, diffId, inputs, { lock, persistUnsafe: persistUnsafe === true });
    await writeDiffSummary(repoCacheRoot, diffId, summary, { lock, persistUnsafe: persistUnsafe === true });
    const eventsFilePath = await writeEventsJsonl(repoCacheRoot, diffId, bounded.events);
    const eventsRelPath = path.relative(repoCacheRoot, eventsFilePath).replace(/\\/g, '/');
    const summaryRelPath = `diffs/${diffId}/summary.json`;

    if (!isObject(manifest.diffs)) manifest.diffs = {};
    manifest.version = Number.isFinite(manifest.version) ? manifest.version : 1;
    manifest.updatedAt = createdAt;
    manifest.diffs[diffId] = {
      id: diffId,
      createdAt,
      from: fromEndpoint,
      to: toEndpoint,
      modes: selectedModes,
      summaryPath: summaryRelPath,
      eventsPath: eventsRelPath,
      truncated: bounded.truncated,
      maxEvents: maxEventsLimit,
      maxBytes: maxBytesLimit,
      compat
    };

    const sortedEntries = sortDiffEntries(Object.values(manifest.diffs || {}));
    manifest.diffs = Object.fromEntries(sortedEntries.map((entry) => [entry.id, entry]));
    await writeDiffsManifest(repoCacheRoot, manifest, { lock, persistUnsafe: persistUnsafe === true });

    return {
      diffId,
      createdAt,
      persisted: true,
      reused: false,
      inputs,
      summary,
      eventsPath: eventsRelPath,
      emittedEvents: bounded.events.length
    };
  });
};

export const listDiffs = ({
  repoRoot,
  userConfig = null,
  modes = []
} = {}) => {
  const repoCacheRoot = getRepoCacheRoot(path.resolve(repoRoot), userConfig);
  const selectedModes = normalizeModes(modes);
  const manifest = loadDiffsManifest(repoCacheRoot);
  const entries = sortDiffEntries(Object.values(manifest.diffs || {}));
  if (!selectedModes.length) return entries;
  return entries.filter((entry) => {
    const entryModes = Array.isArray(entry?.modes) ? entry.modes : [];
    return selectedModes.every((mode) => entryModes.includes(mode));
  });
};

export const showDiff = ({
  repoRoot,
  userConfig = null,
  diffId,
  format = 'summary'
} = {}) => {
  ensureDiffId(diffId);
  const repoCacheRoot = getRepoCacheRoot(path.resolve(repoRoot), userConfig);
  const manifest = loadDiffsManifest(repoCacheRoot);
  const entry = manifest.diffs?.[diffId] || null;
  if (!entry) return null;
  const inputs = loadDiffInputs(repoCacheRoot, diffId);
  const summary = loadDiffSummary(repoCacheRoot, diffId);
  if (String(format || 'summary').trim().toLowerCase() !== 'jsonl') {
    return { entry, inputs, summary };
  }
  const eventsPath = path.join(repoCacheRoot, 'diffs', diffId, 'events.jsonl');
  const events = fs.existsSync(eventsPath)
    ? fs.readFileSync(eventsPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    : [];
  return { entry, inputs, summary, events };
};

export const pruneDiffs = async ({
  repoRoot,
  userConfig = null,
  maxDiffs = DEFAULT_MAX_DIFFS,
  retainDays = DEFAULT_RETAIN_DAYS,
  dryRun = false,
  waitMs = 0
} = {}) => {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
    throw invalidRequest('repoRoot is required.');
  }
  const repoCacheRoot = getRepoCacheRoot(path.resolve(repoRoot), userConfig);
  const maxCount = Number.isFinite(Number(maxDiffs))
    ? Math.max(0, Math.floor(Number(maxDiffs)))
    : DEFAULT_MAX_DIFFS;
  const cutoffMs = Number.isFinite(Number(retainDays))
    ? Date.now() - Math.max(0, Number(retainDays)) * 24 * 60 * 60 * 1000
    : null;
  const dryRunEnabled = dryRun === true;

  return withDiffLock(repoCacheRoot, { waitMs }, async (lock) => {
    const manifest = loadDiffsManifest(repoCacheRoot);
    const entries = sortDiffEntries(Object.values(manifest.diffs || {}));
    const removed = [];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const createdAtMs = parseCreatedAtMs(entry.createdAt);
      const withinKeep = i < maxCount;
      const youngerThanCutoff = cutoffMs == null || createdAtMs >= cutoffMs;
      const keep = cutoffMs == null
        ? withinKeep
        : (withinKeep || youngerThanCutoff);
      if (keep) continue;
      removed.push(entry.id);
      if (!dryRunEnabled) {
        await fsPromises.rm(path.join(repoCacheRoot, 'diffs', entry.id), {
          recursive: true,
          force: true
        });
        delete manifest.diffs[entry.id];
      }
    }
    if (!dryRunEnabled && removed.length) {
      manifest.updatedAt = new Date().toISOString();
      const nextEntries = sortDiffEntries(Object.values(manifest.diffs || {}));
      manifest.diffs = Object.fromEntries(nextEntries.map((entry) => [entry.id, entry]));
      await writeDiffsManifest(repoCacheRoot, manifest, { lock });
    }
    return { dryRun: dryRunEnabled, removed };
  });
};
