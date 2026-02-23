import { sha1 } from '../../shared/hash.js';
import { stableStringify } from '../../shared/stable-json.js';
import { loadChunkMeta, loadJsonArrayArtifact, loadPiecesManifest } from '../../shared/artifact-io.js';
import { summarizeMode } from './events.js';

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const sortedPaths = (iterable) => [...iterable].sort((a, b) => a.localeCompare(b));

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

export const computeModeDiff = async ({
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
