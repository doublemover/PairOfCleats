import { createArtifactOperationReader } from './operation-reader.js';
import { createNeighborReader } from './neighbors.js';
import { resolvePublishedSemanticCoverage } from './coverage-resolution.js';
import { assertSemanticQueryIndex } from '../contracts/validators/semantic-query-index.js';
import { assertQueryIndexRow, compareQueryIndexRows, queryIndexOwnerCompare } from './query-index.js';
import { canonicalSemanticJson, semanticHash } from '../index/semantic/identity.js';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readJsonlRowsAt, validateOffsetsAgainstFile } from '../shared/artifact-io/offsets.js';
import { throwIfAborted } from '../shared/abort.js';
import { assertCurrentIndexFormat } from '../contracts/index-format.js';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';
import { validateSemanticRecord } from '../contracts/validators/semantic.js';

const FAMILY = {
  semantic_lookup: 'lookup', semantic_records: 'node', semantic_operands: 'operand', semantic_edges: 'edge',
  semantic_ownership: 'ownership', semantic_coverage: 'coverage', semantic_frontier: 'frontier'
};
const error = (message) => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_INTEGRITY' });

/** Resolve a validated immutable part without following a link outside its root. */
export const resolveSemanticPartPath = async (root, relativePath) => {
  if (typeof relativePath !== 'string' || relativePath.includes('\\') || relativePath.includes(':')
    || relativePath.startsWith('/') || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw error('Invalid semantic part path.');
  }
  const absoluteRoot = await fs.realpath(root);
  const absolute = await fs.realpath(path.join(absoluteRoot, relativePath));
  const relative = path.relative(absoluteRoot, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw error('Semantic part escapes staging root.');
  return absolute;
};

const hashFile = async (filePath, signal) => {
  const handle = await fs.open(filePath, 'r');
  const hash = createHash('sha256');
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      throwIfAborted(signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally { await handle.close(); }
  return hash.digest('hex');
};

/**
 * Artifact backend for completed staging/published descriptors. Publication must
 * validate all parts first. Cache only bounded validation metadata, never nodes.
 */
export const createArtifactSemanticStore = ({
  root, repoRoot, artifactSurfaceVersion, generation, partitions, completedTasks = [],
  operationIndex = null, queryIndex: inputQueryIndex = null, maxRecords = 128, maxRecordBytes = 1048576, validationCacheEntries = 64
}) => {
  assertCurrentIndexFormat({
    operation: 'semantic_detail', component: 'semantic family', foundVersion: artifactSurfaceVersion,
    repoRoot, indexPath: root
  });
  assertSemanticEnvelope('generation', generation);
  const queryIndex = inputQueryIndex ? structuredClone(inputQueryIndex) : null;
  const inventory = new Map();
  for (const partition of structuredClone(partitions)) {
    assertSemanticEnvelope('partition', partition);
    if (inventory.has(partition.partitionId)) throw error('Duplicate semantic partition identity.');
    inventory.set(partition.partitionId, partition);
  }
  const validated = new Map();
  const validatePiece = async (piece, signal) => {
    const [dataPath, offsetsPath] = await Promise.all([
      resolveSemanticPartPath(root, piece.path), resolveSemanticPartPath(root, piece.offsetsPath)
    ]);
    const [dataStat, offsetsStat] = await Promise.all([fs.stat(dataPath), fs.stat(offsetsPath)]);
    const key = dataPath + ':' + piece.hash + ':' + piece.offsetsHash;
    const signature = [dataStat.size, dataStat.mtimeMs, dataStat.ctimeMs,
      offsetsStat.size, offsetsStat.mtimeMs, offsetsStat.ctimeMs].join(':');
    if (validated.get(key) !== signature) {
      if (dataStat.size !== piece.bytes || offsetsStat.size !== piece.count * 8
        || await hashFile(dataPath, signal) !== piece.hash
        || await hashFile(offsetsPath, signal) !== piece.offsetsHash) throw error('Semantic part hash/size mismatch.');
      await validateOffsetsAgainstFile(dataPath, offsetsPath);
      validated.set(key, signature);
      while (validated.size > validationCacheEntries) validated.delete(validated.keys().next().value);
    }
    return { dataPath, offsetsPath };
  };
  const getRecords = async (refs, fields = ['span', 'scope', 'data'], { signal = null, metrics = null } = {}) => {
    if (!Array.isArray(refs) || refs.length > maxRecords) throw error('Semantic record request exceeds its limit.');
    if (!Array.isArray(fields) || fields.some((field) => !['span', 'scope', 'data'].includes(field))) {
      throw error('Unknown semantic detail field group.');
    }
    const work = new Map();
    const results = new Array(refs.length);
    for (let index = 0; index < refs.length; index += 1) {
      const ref = refs[index];
      const check = validateSemanticRecord('recordRef', ref);
      if (!check.ok) throw error(check.errors.join('; '));
      const partition = inventory.get(ref.partitionId);
      if (!partition) throw error('Record partition is not in the pinned generation.');
      const pieces = partition.members.semantic_records;
      // Binary search stable row ranges, independent of shard layout.
      let low = 0;
      let high = pieces.length - 1;
      let piece = null;
      while (low <= high) {
        const middle = (low + high) >>> 1;
        const candidate = pieces[middle];
        if (ref.localId < candidate.firstRow) high = middle - 1;
        else if (ref.localId >= candidate.firstRow + candidate.count) low = middle + 1;
        else { piece = candidate; break; }
      }
      if (!piece) { results[index] = null; continue; }
      if (!work.has(piece)) work.set(piece, []);
      work.get(piece).push({ ref, index });
    }
    for (const [piece, selected] of work) {
      throwIfAborted(signal);
      const { dataPath, offsetsPath } = await validatePiece(piece, signal);
      const rows = await readJsonlRowsAt(dataPath, offsetsPath,
        selected.map(({ ref }) => ref.localId - piece.firstRow), { maxBytes: maxRecordBytes, metrics });
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const { ref, index } = selected[i];
        if (!row || row.id !== ref.localId || !validateSemanticRecord('node', row).ok) {
          throw error('Invalid semantic node or local-ID lookup.');
        }
        results[index] = {
          ref, id: row.id, kind: row.kind,
          ...Object.fromEntries(fields.map((field) => [field, row[field]])),
          availableFieldGroups: ['span', 'scope', 'data'],
          omittedFieldGroups: ['span', 'scope', 'data'].filter((field) => !fields.includes(field))
        };
      }
    }
    return results;
  };
  const iterateRows = async function* (partitionId, member, { signal = null, batchRows = 128 } = {}) {
    const partition = inventory.get(partitionId);
    if (!partition || !Object.hasOwn(partition.members, member)) throw error('Unknown semantic partition/member.');
    if (!Number.isSafeInteger(batchRows) || batchRows <= 0 || batchRows > maxRecords) throw error('Invalid hydration batch.');
    for (const piece of partition.members[member]) {
      const { dataPath, offsetsPath } = await validatePiece(piece, signal);
      for (let start = 0; start < piece.count; start += batchRows) {
        throwIfAborted(signal);
        const indexes = Array.from({ length: Math.min(batchRows, piece.count - start) }, (_, i) => start + i);
        const rows = await readJsonlRowsAt(dataPath, offsetsPath, indexes, { maxBytes: maxRecordBytes });
        for (const row of rows) {
          if (FAMILY[member] && !validateSemanticRecord(FAMILY[member], row,
            { structuralSlots: partition.structuralSlots }).ok) throw error('Invalid semantic member row.');
          if (member === 'semantic_sources') assertSemanticEnvelope('source', row);
          yield row;
        }
      }
    }
  };
  const getSourceSpans = async (refs, { signal = null, maxBytes = 65536 } = {}) => {
    const records = await getRecords(refs, ['span'], { signal });
    const sourceByPartition = new Map();
    const decodedSources = new Map();
    let decodedBytes = 0;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw error('Invalid source response budget.');
    const result = [];
    let returnedBytes = 0;
    for (let index = 0; index < records.length; index += 1) {
      throwIfAborted(signal);
      const record = records[index];
      if (!record || record.span === null) { result.push(null); continue; }
      const partitionId = refs[index].partitionId;
      let source = sourceByPartition.get(partitionId);
      if (!source) {
        for await (const row of iterateRows(partitionId, 'semantic_sources', { signal })) {
          if (source) throw error('Multiple semantic source manifests.');
          source = row;
        }
        if (!source) throw error('Missing semantic source manifest.');
        sourceByPartition.set(partitionId, source);
      }
      // Bound source decoding separately from response bytes. Large snapshots
      // require a future indexed decoder; never substitute working-tree text.
      if (source.byteLength > maxRecordBytes) throw error('Source hydration exceeds decoded-source allowance.');
      let text = decodedSources.get(source.byteHash);
      if (text === undefined) {
        decodedBytes += source.byteLength;
        if (decodedBytes > maxRecordBytes) throw error('Source hydration exceeds decoded-source allowance.');
        const filePath = await resolveSemanticPartPath(root, 'semantic-sources/' + source.byteHash + '.utf8');
        if ((await fs.stat(filePath)).size !== source.byteLength) throw error('Source size mismatch.');
        const bytes = await fs.readFile(filePath);
        if (createHash('sha256').update(bytes).digest('hex') !== source.byteHash) throw error('Source hash mismatch.');
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        if (text.length !== source.textLength || createHash('sha256').update(text, 'utf8').digest('hex') !== source.textHash) {
          throw error('Source text identity mismatch.');
        }
        decodedSources.set(source.byteHash, text);
      }
      if (record.span[1] > text.length) throw error('Source range mismatch.');
      const excerpt = text.slice(record.span[0], record.span[1]);
      returnedBytes += Buffer.byteLength(excerpt);
      if (returnedBytes > maxBytes) throw error('Source excerpts exceed response byte limit.');
      result.push({ ref: refs[index], sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash,
        coordinateUnit: 'utf16', span: record.span, text: excerpt });
    }
    return result;
  };
  const getCoverage = async (partitionIds, { signal = null } = {}) => {
    if (partitionIds.length > maxRecords) throw error('Coverage request exceeds record allowance.');
    const rows = [];
    const sources = new Set(partitionIds.map(id => inventory.get(id)?.sourceUnitId));
    const selected = [...inventory.values()].filter(p => sources.has(p.sourceUnitId)).sort((a,b) => a.partitionId < b.partitionId ? -1 : a.partitionId > b.partitionId ? 1 : 0);
    for (const { partitionId } of selected) {
      for await (const row of iterateRows(partitionId, 'semantic_coverage', { signal })) {
        if (rows.length >= 512) throw error('Coverage response exceeds allowance.');
        rows.push({ ...row, partitionId });
      }
    }
    return resolvePublishedSemanticCoverage(rows,{generation,completedTasks,sourceForPartition:id=>inventory.get(id)?.sourceUnitId});
  };
  const readMemberRows = async (partitionId, member, ordinals, { signal = null, metrics = null } = {}) => {
    const partition = inventory.get(partitionId);
    if (!partition || !FAMILY[member] || !Array.isArray(ordinals) || ordinals.length > 512) throw error('Invalid semantic member hydration.');
    const work = new Map(), results = new Array(ordinals.length);
    for (let index = 0; index < ordinals.length; index += 1) {
      const ordinal = ordinals[index];
      if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw error('Invalid member ordinal.');
      const pieces = partition.members[member];
      let low = 0, high = pieces.length - 1, piece = null;
      while (low <= high) {
        const middle = (low + high) >>> 1, candidate = pieces[middle];
        if (ordinal < candidate.firstRow) high = middle - 1;
        else if (ordinal >= candidate.firstRow + candidate.count) low = middle + 1;
        else { piece = candidate; break; }
      }
      if (!piece) throw error('Query index points outside its semantic member.');
      if (!work.has(piece)) work.set(piece, []);
      work.get(piece).push({ ordinal, index });
    }
    for (const [piece, selected] of work) {
      throwIfAborted(signal);
      const { dataPath, offsetsPath } = await validatePiece(piece, signal);
      const rows = await readJsonlRowsAt(dataPath, offsetsPath, selected.map(({ ordinal }) => ordinal - piece.firstRow), { maxBytes: maxRecordBytes, metrics });
      for (let i = 0; i < rows.length; i += 1) {
        if (!validateSemanticRecord(FAMILY[member], rows[i], { structuralSlots: partition.structuralSlots }).ok) throw error('Invalid hydrated semantic member.');
        results[selected[i].index] = rows[i];
      }
    }
    return results;
  };
  let checkedQueryIndex = false;
  const checkQueryIndex = () => {
    if (!queryIndex) throw Object.assign(new Error('This generation has no semantic query lookup index.'), { code: 'ERR_SEMANTIC_QUERY_INDEX_UNAVAILABLE' });
    if (checkedQueryIndex) return;
    assertSemanticQueryIndex(queryIndex);
    if (queryIndex.schemaVersion !== 1 || canonicalSemanticJson(queryIndex.generation) !== canonicalSemanticJson(generation)
      || !Array.isArray(queryIndex.partitionHashes) || !Array.isArray(queryIndex.pieces)) throw error('Invalid query index generation.');
    const expected = [...inventory.values()].sort((a, b) => a.partitionId < b.partitionId ? -1 : a.partitionId > b.partitionId ? 1 : 0)
      .map(({ partitionId, canonicalHash }) => ({ partitionId, canonicalHash }));
    if (canonicalSemanticJson(expected) !== canonicalSemanticJson(queryIndex.partitionHashes)) throw error('Query index partition inventory mismatch.');
    let next = 0, previous = null;
    for (const piece of queryIndex.pieces) {
      assertQueryIndexRow(piece.firstKey); assertQueryIndexRow(piece.lastKey);
      if (piece.firstRow !== next || piece.count < 1 || compareQueryIndexRows(piece.firstKey, piece.lastKey) > 0
        || (previous && compareQueryIndexRows(previous, piece.firstKey) >= 0)) throw error('Invalid query index ranges.');
      next += piece.count; previous = piece.lastKey;
    }
    if (next !== queryIndex.rowCount) throw error('Query index count mismatch.');
    checkedQueryIndex = true;
  };
  const readQueryIndexRow = async (ordinal, signal, metrics) => {
    const pieces = queryIndex.pieces;
    let low = 0, high = pieces.length - 1, piece = null;
    while (low <= high) {
      const middle = (low + high) >>> 1, candidate = pieces[middle];
      if (ordinal < candidate.firstRow) high = middle - 1;
      else if (ordinal >= candidate.firstRow + candidate.count) low = middle + 1;
      else { piece = candidate; break; }
    }
    if (!piece) throw error('Query index row out of range.');
    const { dataPath, offsetsPath } = await validatePiece(piece, signal);
    const [row] = await readJsonlRowsAt(dataPath, offsetsPath, [ordinal - piece.firstRow], { maxBytes: maxRecordBytes, metrics });
    assertQueryIndexRow(row);
    if (compareQueryIndexRows(row, piece.firstKey) < 0 || compareQueryIndexRows(row, piece.lastKey) > 0) throw error('Query index key range mismatch.');
    return row;
  };
  const getRelatedPage = async (ref, member, { offset = 0, limit = 128, signal = null, metrics = null } = {}) => {
    throwIfAborted(signal);
    checkQueryIndex();
    if (!validateSemanticRecord('recordRef', ref).ok || !inventory.has(ref.partitionId)
      || !['semantic_operands', 'semantic_ownership', 'semantic_lookup', 'semantic_records', 'semantic_edges'].includes(member)
      || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 512) throw error('Invalid related semantic request.');
    const bound = async (upper) => {
      let low = 0, high = queryIndex.rowCount;
      while (low < high) {
        throwIfAborted(signal);
        const middle = Math.floor((low + high) / 2);
        const row = await readQueryIndexRow(middle, signal, metrics);
        const compare = queryIndexOwnerCompare(row, ref, member);
        if (compare < 0 || (upper && compare === 0)) low = middle + 1;
        else high = middle;
      }
      return low;
    };
    const start = await bound(false), end = await bound(true);
    if (offset > end - start) throw error('Related semantic cursor exceeds member rows.');
    const selected = [];
    for (let ordinal = start + offset; ordinal < Math.min(end, start + offset + limit); ordinal += 1) {
      const row = await readQueryIndexRow(ordinal, signal, metrics);
      if (queryIndexOwnerCompare(row, ref, member) !== 0) throw error('Query index owner mismatch.');
      selected.push(row);
    }
    const rows = [];
    const work = new Map();
    for (let i = 0; i < selected.length; i += 1) {
      const entry = selected[i];
      if (!work.has(entry.partitionId)) work.set(entry.partitionId, []);
      work.get(entry.partitionId).push({ entry, index: i });
    }
    for (const [partitionId, entries] of work) {
      const hydrated = await readMemberRows(partitionId, member, entries.map(({ entry }) => entry.rowOrdinal), { signal, metrics });
      for (let i = 0; i < entries.length; i += 1) {
        const row = hydrated[i];
        const owner = member === 'semantic_records' ? row.data.expression : member === 'semantic_operands' ? row.parent : member === 'semantic_ownership' ? row.recordRef
          : { partitionId, localId: row.id };
        const matches = member === 'semantic_edges'
          ? [row.from, row.to].some(endpoint => canonicalSemanticJson(endpoint) === canonicalSemanticJson(ref))
          : canonicalSemanticJson(owner) === canonicalSemanticJson(ref);
        if (!matches) throw error('Query index points to a different owner.');
        rows[entries[i].index] = member === 'semantic_lookup' ? { partitionId, id: row.id, value: row.value }
          : member === 'semantic_records' ? { ...row, ref: { partitionId, localId: row.id },
            availableFieldGroups: ['span', 'scope', 'data'], omittedFieldGroups: [] } : row;
      }
    }
    return { rows, offset: offset + rows.length, done: start + offset + rows.length === end };
  };
  const verifySource = async (source, { signal = null } = {}) => {
    const file = await resolveSemanticPartPath(root, 'semantic-sources/' + source.byteHash + '.utf8');
    const byteHash = createHash('sha256'), textHash = createHash('sha256');
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    let byteLength = 0, textLength = 0;
    for await (const bytes of createReadStream(file, { highWaterMark: 65536, signal: signal || undefined })) {
      throwIfAborted(signal);
      byteLength += bytes.length;
      if (byteLength > source.byteLength) throw error('Retained semantic source size mismatch.');
      byteHash.update(bytes);
      const text = decoder.decode(bytes, { stream: true });
      textLength += text.length; textHash.update(text, 'utf8');
    }
    const tail = decoder.decode(); textLength += tail.length; textHash.update(tail, 'utf8');
    if (byteLength !== source.byteLength || textLength !== source.textLength
      || byteHash.digest('hex') !== source.byteHash || textHash.digest('hex') !== source.textHash) {
      throw error('Retained semantic source hash or length mismatch.');
    }
  };
  return { findOperations: createArtifactOperationReader({ index: operationIndex, inventory, generation, validatePiece }), backend: 'artifact', storeId: root, cursorScope: semanticHash('semantic.store-inventory.v1', [...inventory.values()].map(({partitionId, canonicalHash}) => ({partitionId, canonicalHash})).sort((a,b) => a.partitionId < b.partitionId ? -1 : a.partitionId > b.partitionId ? 1 : 0)), verifySource, repoRoot, generation: { ...generation }, getRecords, getSourceSpans, getCoverage, iterateRows, readMemberRows, getRelatedPage, getNeighbors: createNeighborReader(getRelatedPage) };

};
