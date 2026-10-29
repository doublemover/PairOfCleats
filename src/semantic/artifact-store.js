import { createArtifactOperationReader } from './operation-reader.js';
import { createSourceReferenceReader } from './source-references.js';
import { createNeighborReader } from './neighbors.js';
import { captureSemanticDetailFields, captureSemanticRecordRef, captureSemanticRecordRefs } from './reader-input.js';
import { resolvePublishedSemanticCoverage } from './coverage-resolution.js';
import { assertSemanticQueryIndex } from '../contracts/validators/semantic-query-index.js';
import { assertQueryIndexRow, compareQueryIndexRows, queryIndexOwnerCompare } from './query-index.js';
import { canonicalSemanticJson, semanticHash } from '../index/semantic/identity.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { openJsonlRowReader } from '../shared/artifact-io/offsets.js';
import { throwIfAborted } from '../shared/abort.js';
import { assertCurrentIndexFormat } from '../contracts/index-format.js';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';
import { validateSemanticRecord } from '../contracts/validators/semantic.js';
import { observeStorageResource } from '../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../shared/storage/operation-error.js';
import { readVerifiedContainedFile, withContainedFile } from '../shared/contained-file.js';
import { closeSemanticReaders, completeSemanticReaderCleanup, semanticReaderFailure,
  withSemanticReaderCleanup } from './reader-lifetime.js';

const FAMILY = {
  semantic_lookup: 'lookup', semantic_records: 'node', semantic_operands: 'operand', semantic_edges: 'edge',
  semantic_ownership: 'ownership', semantic_coverage: 'coverage', semantic_frontier: 'frontier'
};
const error = (message) => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_INTEGRITY' });
const CONTENT_BOUNDARY_VALIDATIONS = new Map();
const MAX_CONTENT_BOUNDARY_VALIDATIONS = 256;
const READ_SCOPES = new AsyncLocalStorage();
const MAX_SCOPED_READERS = 4;
const MAX_SCOPED_READER_BYTES = 1024 * 1024;
const READER_BLOCK_BYTES = 64 * 1024;
const retainedReaderBytes = piece => {
  const offsetsBytes = piece.count * 8;
  if (piece.bytes <= READER_BLOCK_BYTES && offsetsBytes <= READER_BLOCK_BYTES) return piece.bytes + offsetsBytes;
  // Large readers retain block digests, not their full payload. Reserve scratch
  // as well, independently of positioned read/response allocation bounds.
  return 2 * READER_BLOCK_BYTES
    + (Math.ceil(piece.bytes / READER_BLOCK_BYTES) + Math.ceil(offsetsBytes / READER_BLOCK_BYTES)) * 32;
};

const assertSemanticPartPath = (relativePath) => {
  if (typeof relativePath !== 'string' || relativePath.includes('\\') || relativePath.includes(':')
    || relativePath.startsWith('/') || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw error('Invalid semantic part path.');
  }
};

const resolvePhysicalPartPath = async (absoluteRoot, relativePath) => {
  const absolute = await fs.realpath(path.join(absoluteRoot, relativePath));
  const relative = path.relative(absoluteRoot, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw error('Semantic part escapes staging root.');
  return absolute;
};

/** Resolve a validated immutable part without following a link outside its root. */
export const resolveSemanticPartPath = async (root, relativePath) => {
  assertSemanticPartPath(relativePath);
  return resolvePhysicalPartPath(await fs.realpath(root), relativePath);
};

// Contained reads validate the authorized lexical root and every component
// themselves. Canonicalizing just the target first loses a valid aliased
// ancestor and bypasses the relative components that must reject links.
const resolveContainedSemanticPartPath = (root, relativePath) => {
  assertSemanticPartPath(relativePath);
  return path.resolve(root, relativePath);
};

/**
 * Artifact backend for completed staging/published descriptors. Publication must
 * validate all parts first. Persistent caches contain validation metadata only.
 * A logical read scope shares up to four verified piece pairs across operation,
 * node and query-index reads, with a separate 1-MiB retention admission budget.
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
  generation = Object.freeze({ ...generation });
  operationIndex = operationIndex ? structuredClone(operationIndex) : null;
  completedTasks = structuredClone(completedTasks);
  const queryIndex = inputQueryIndex ? structuredClone(inputQueryIndex) : null;
  const inventory = new Map();
  for (const partition of structuredClone(partitions)) {
    assertSemanticEnvelope('partition', partition);
    if (inventory.has(partition.partitionId)) throw error('Duplicate semantic partition identity.');
    inventory.set(partition.partitionId, partition);
  }
  const validated = new Map();
  const scopeOwner = Symbol('semantic-store-read-scope');
  const currentReadScope = () => {
    const scope = READ_SCOPES.getStore();
    if (scope?.owner !== scopeOwner) return null;
    if (scope?.closed) throw error('Semantic read scope has already settled.');
    return scope;
  };
  const pieceReadError = caught => {
    // Classification cannot turn pending original work into an ordinary content
    // diagnostic, including when a verified snapshot failed to close its files.
    const observation = observeStorageResource(caught, { phase: 'semantic-piece-read' });
    observation.requireSettled();
    let code;
    try { code = caught?.code; }
    catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
    observation.requireSettled();
    return code === 'ERR_JSONL_CONTENT_INTEGRITY'
      ? addStorageFailureContext(error('Semantic part hash/size mismatch.'), {}, observation.retain(), { secondaryPresent: true })
      : caught;
  };
  const retainedSourceFailure = caught => {
    const observation = observeStorageResource(caught, { phase: 'semantic-retained-source-read' });
    observation.requireSettled();
    let code;
    try { code = caught?.code; }
    catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
    observation.requireSettled();
    return ['ERR_FILE_CHANGED', 'ERR_FILE_TOO_LARGE', 'ERR_FILE_INTEGRITY', 'ERR_UNSAFE_FILE_PATH'].includes(code)
      ? addStorageFailureContext(error('Retained semantic source hash, size or containment mismatch.'), {},
        observation.retain(), { secondaryPresent: true }) : caught;
  };
  const openVerifiedPieceReader = async (piece, signal) => {
    throwIfAborted(signal);
    assertSemanticPartPath(piece.path);
    assertSemanticPartPath(piece.offsetsPath);
    const absoluteRoot = await fs.realpath(root);
    const [dataPath, offsetsPath] = await Promise.all([
      resolvePhysicalPartPath(absoluteRoot, piece.path), resolvePhysicalPartPath(absoluteRoot, piece.offsetsPath)
    ]);
    const key = dataPath + ':' + piece.hash + ':' + piece.offsetsHash;
    const reader = await openJsonlRowReader(dataPath, offsetsPath);
    try {
      await reader.verify({ jsonlBytes: piece.bytes, offsetsBytes: piece.count * 8,
        jsonlHash: piece.hash, offsetsHash: piece.offsetsHash, signal });
      // Reuse boundary-validation metadata only after rehashing the current bytes.
      // Equal timestamps cannot prove an unchanged part on supported filesystems.
      if (!validated.has(key)) {
        // Publication and projection create several readers for the same parts.
        // Reuse successful boundary checks across those readers only after the
        // current operation has proved both content hashes above.
        if (!CONTENT_BOUNDARY_VALIDATIONS.has(key)) {
          await reader.validateOffsets({ signal });
        } else {
          CONTENT_BOUNDARY_VALIDATIONS.delete(key);
        }
        CONTENT_BOUNDARY_VALIDATIONS.set(key, true);
        while (CONTENT_BOUNDARY_VALIDATIONS.size > MAX_CONTENT_BOUNDARY_VALIDATIONS) {
          CONTENT_BOUNDARY_VALIDATIONS.delete(CONTENT_BOUNDARY_VALIDATIONS.keys().next().value);
        }
        validated.set(key, true);
        while (validated.size > validationCacheEntries) validated.delete(validated.keys().next().value);
      }
      return {
        async readRows(indexes, options) {
          try { return await reader.readRows(indexes, options); }
          catch (caught) { throw pieceReadError(caught); }
        },
        close: () => reader.close()
      };
    } catch (caught) {
      return withSemanticReaderCleanup(() => { throw pieceReadError(caught); }, () => reader.close());
    }
  };
  const readPieceRows = async (piece, indexes, { signal = null, ...options } = {}) => {
    const scope = currentReadScope();
    const charge = retainedReaderBytes(piece);
    if (scope && !scope.readers.has(piece) && scope.readers.size < MAX_SCOPED_READERS
      && scope.readerBytes + scope.operationRowBytes + charge <= MAX_SCOPED_READER_BYTES) {
      scope.readerBytes += charge;
      // Admission precedes async open so concurrent probes share this exact
      // verified owner and cannot exceed the reader or retention budgets.
      scope.readers.set(piece, openVerifiedPieceReader(piece, signal));
    }
    if (scope?.readers.has(piece)) {
      return (await scope.readers.get(piece)).readRows(indexes, { ...options, signal });
    }
    const reader = await openVerifiedPieceReader(piece, signal);
    return withSemanticReaderCleanup(() => reader.readRows(indexes, { ...options, signal }), () => reader.close());
  };
  const withReadScope = async run => {
    if (currentReadScope()) return run();
    const scope = { owner: scopeOwner, readers: new Map(), readerBytes: 0,
      operationRanges: new Map(), operationRows: new Map(), operationRowBytes: 0,
      operationMemoMaxBytes: MAX_SCOPED_READER_BYTES, closed: false };
    return withSemanticReaderCleanup(() => READ_SCOPES.run(scope, run), async () => {
      scope.closed = true;
      scope.operationRanges.clear(); scope.operationRows.clear(); scope.operationRowBytes = 0;
      await closeSemanticReaders(scope.readers);
    });
  };
  const getRecords = async (refs, fields = ['span', 'scope', 'data'], { signal = null, metrics = null } = {}) => {
    refs = captureSemanticRecordRefs(refs, maxRecords, error);
    fields = captureSemanticDetailFields(fields, error);
    const work = new Map();
    const results = new Array(refs.length);
    for (let index = 0; index < refs.length; index += 1) {
      const ref = refs[index];
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
      const rows = await readPieceRows(piece,
        selected.map(({ ref }) => ref.localId - piece.firstRow), { maxBytes: maxRecordBytes, metrics, signal });
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
      const reader = await openVerifiedPieceReader(piece, signal);
      let primary, primaryPresent = false;
      try {
        for (let start = 0; start < piece.count; start += batchRows) {
          throwIfAborted(signal);
          const indexes = Array.from({ length: Math.min(batchRows, piece.count - start) }, (_, i) => start + i);
          const rows = await reader.readRows(indexes, { maxBytes: maxRecordBytes, signal });
          for (const row of rows) {
            if (FAMILY[member] && !validateSemanticRecord(FAMILY[member], row,
              { structuralSlots: partition.structuralSlots }).ok) throw error('Invalid semantic member row.');
            if (member === 'semantic_sources') assertSemanticEnvelope('source', row);
            yield row;
          }
        }
      } catch (caught) { primary = caught; primaryPresent = true; throw caught; }
      finally { await completeSemanticReaderCleanup(() => reader.close(), primary, primaryPresent); }
    }
  };
  const getSourceReference = createSourceReferenceReader({
    sourceUnitForPartition: id => inventory.get(id)?.sourceUnitId, iterateRows
  });
  const getSourceSpans = async (refs, { signal = null, maxBytes = 65536 } = {}) => {
    refs = captureSemanticRecordRefs(refs, maxRecords, error);
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
      if (source.encoding === 'binary') { result.push(null); continue; }
      // Bound source decoding separately from response bytes. Large snapshots
      // require a future indexed decoder; never substitute working-tree text.
      if (source.byteLength > maxRecordBytes) throw Object.assign(new Error('Source hydration exceeds decoded-source allowance.'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
      let text = decodedSources.get(source.byteHash);
      if (text === undefined) {
        decodedBytes += source.byteLength;
        if (decodedBytes > maxRecordBytes) throw Object.assign(new Error('Source hydration exceeds decoded-source allowance.'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
        const filePath = resolveContainedSemanticPartPath(root, 'semantic-sources/' + source.byteHash + '.utf8');
        let bytes;
        try {
          ({ buffer: bytes } = await readVerifiedContainedFile(root, filePath, {
            maxBytes: source.byteLength, expectedBytes: source.byteLength, expectedHash: source.byteHash, signal
          }));
        } catch (caught) { throw retainedSourceFailure(caught); }
        throwIfAborted(signal);
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        if (text.length !== source.textLength || createHash('sha256').update(text, 'utf8').digest('hex') !== source.textHash) {
          throw error('Source text identity mismatch.');
        }
        decodedSources.set(source.byteHash, text);
      }
      if (record.span[1] > text.length) throw error('Source range mismatch.');
      for (const offset of record.span) {
        if (offset > 0 && offset < text.length && text.charCodeAt(offset - 1) >= 0xd800
          && text.charCodeAt(offset - 1) <= 0xdbff && text.charCodeAt(offset) >= 0xdc00
          && text.charCodeAt(offset) <= 0xdfff) throw error('Source excerpt span splits a Unicode scalar.');
      }
      const excerpt = text.slice(record.span[0], record.span[1]);
      returnedBytes += Buffer.byteLength(excerpt);
      if (returnedBytes > maxBytes) throw Object.assign(new Error('Source excerpts exceed response byte limit.'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
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
      const rows = await readPieceRows(piece, selected.map(({ ordinal }) => ordinal - piece.firstRow),
        { maxBytes: maxRecordBytes, metrics, signal });
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
  const readQueryIndexRow = async (ordinal, signal, metrics, readers, scope) => {
    const pieces = queryIndex.pieces;
    let low = 0, high = pieces.length - 1, piece = null;
    while (low <= high) {
      const middle = (low + high) >>> 1, candidate = pieces[middle];
      if (ordinal < candidate.firstRow) high = middle - 1;
      else if (ordinal >= candidate.firstRow + candidate.count) low = middle + 1;
      else { piece = candidate; break; }
    }
    if (!piece) throw error('Query index row out of range.');
    const indexes = [ordinal - piece.firstRow], options = { maxBytes: maxRecordBytes, metrics, signal };
    let values;
    if (scope) {
      values = await readPieceRows(piece, indexes, options);
    } else {
      if (!readers.has(piece) && readers.size < MAX_SCOPED_READERS) {
        readers.set(piece, openVerifiedPieceReader(piece, signal));
      }
      values = readers.has(piece)
        ? await (await readers.get(piece)).readRows(indexes, options)
        : await readPieceRows(piece, indexes, options);
    }
    const [row] = values;
    assertQueryIndexRow(row);
    if (compareQueryIndexRows(row, piece.firstKey) < 0 || compareQueryIndexRows(row, piece.lastKey) > 0) throw error('Query index key range mismatch.');
    return row;
  };
  const getRelatedPage = async (ref, member, { offset = 0, limit = 128, signal = null, metrics = null } = {}) => {
    ref = captureSemanticRecordRef(ref, error);
    throwIfAborted(signal);
    checkQueryIndex();
    if (!inventory.has(ref.partitionId)
      || !['semantic_operands', 'semantic_ownership', 'semantic_lookup', 'semantic_records', 'semantic_edges'].includes(member)
      || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 512) throw error('Invalid related semantic request.');
    const scope = currentReadScope();
    const queryRows = new Map(), readers = new Map();
    return withSemanticReaderCleanup(async () => {
      const readRow = ordinal => {
        if (!queryRows.has(ordinal)) queryRows.set(ordinal,
          readQueryIndexRow(ordinal, signal, metrics, readers, scope));
        return queryRows.get(ordinal);
      };
      const bound = async (upper) => {
        let low = 0, high = queryIndex.rowCount;
        while (low < high) {
          throwIfAborted(signal);
          const middle = Math.floor((low + high) / 2);
          const row = await readRow(middle);
          const compare = queryIndexOwnerCompare(row, ref, member);
          if (compare < 0 || (upper && compare === 0)) low = middle + 1;
          else high = middle;
        }
        return low;
      };
      // Await both searches on failure too, before disposing their shared files.
      const bounds = await Promise.allSettled([bound(false), bound(true)]);
      const failures = bounds.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw semanticReaderFailure(failures);
      const [start, end] = bounds.map(result => result.value);
      if (offset > end - start) throw error('Related semantic cursor exceeds member rows.');
      const selected = [];
      for (let ordinal = start + offset; ordinal < Math.min(end, start + offset + limit); ordinal += 1) {
        const row = await readRow(ordinal);
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
    }, () => closeSemanticReaders(readers));
  };
  const verifySource = async (source, { signal = null, spans = [] } = {}) => {
    throwIfAborted(signal);
    // Own only the identity fields consumed across awaits; line-start inventories
    // and caller source containers need no full clone for streamed verification.
    const expected = { coordinateUnit: source.coordinateUnit, encoding: source.encoding,
      byteLength: source.byteLength, textLength: source.textLength, byteHash: source.byteHash, textHash: source.textHash };
    const length = expected.coordinateUnit === 'byte' ? expected.byteLength : expected.textLength;
    if (!Array.isArray(spans) || spans.length > 16384 || spans.some(span => !Array.isArray(span) || span.length !== 2
      || span.some(offset => !Number.isSafeInteger(offset) || offset < 0 || offset > length) || span[1] < span[0])) {
      throw error('Retained semantic source span is outside its coordinate allowance.');
    }
    const boundaries = expected.encoding === 'binary' ? [] : [...new Set(spans.flat())].sort((a, b) => a - b);
    let nextBoundary = 0;
    const file = resolveContainedSemanticPartPath(root, 'semantic-sources/' + expected.byteHash + '.utf8');
    const byteHash = createHash('sha256'), textHash = createHash('sha256');
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    let byteLength = 0, textLength = 0;
    const consumeText = text => {
      while (nextBoundary < boundaries.length && boundaries[nextBoundary] <= textLength + text.length) {
        const relative = boundaries[nextBoundary++] - textLength;
        if (relative > 0 && relative < text.length && text.charCodeAt(relative - 1) >= 0xd800
          && text.charCodeAt(relative - 1) <= 0xdbff && text.charCodeAt(relative) >= 0xdc00
          && text.charCodeAt(relative) <= 0xdfff) throw error('Retained semantic source span splits a Unicode scalar.');
      }
      textLength += text.length; textHash.update(text, 'utf8');
    };
    try {
      await withContainedFile(root, file, async descriptor => {
        const before = await descriptor.stat();
        if (!Number.isSafeInteger(expected.byteLength) || before.size !== expected.byteLength) throw error('Retained semantic source size mismatch.');
        const scratch = Buffer.alloc(65536);
        while (true) {
          throwIfAborted(signal);
          // The extra EOF probe can detect growth without admitting a source-sized
          // allocation or reading more than the pinned size plus one byte.
          const allowance = Math.min(scratch.length, expected.byteLength - byteLength + 1);
          const { bytesRead } = await descriptor.read(scratch, 0, allowance, byteLength);
          if (!Number.isInteger(bytesRead) || bytesRead < 0 || bytesRead > allowance) throw error('Invalid retained source read count.');
          if (!bytesRead) break;
          byteLength += bytesRead;
          if (byteLength > expected.byteLength) throw error('Retained semantic source size mismatch.');
          const bytes = scratch.subarray(0, bytesRead);
          byteHash.update(bytes);
          consumeText(expected.encoding === 'binary' ? '' : decoder.decode(bytes, { stream: true }));
        }
        consumeText(expected.encoding === 'binary' ? '' : decoder.decode());
        const after = await descriptor.stat();
        if (byteLength !== expected.byteLength || textLength !== expected.textLength || after.size !== expected.byteLength
          || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
          || byteHash.digest('hex') !== expected.byteHash || textHash.digest('hex') !== expected.textHash) {
          throw error('Retained semantic source hash or length mismatch.');
        }
        descriptor.verify();
      });
    } catch (caught) { throw retainedSourceFailure(caught); }
    throwIfAborted(signal);
  };
  return { withReadScope, getPartitionSourceUnitId: id => inventory.get(id)?.sourceUnitId || null,
    findOperations: createArtifactOperationReader({ index: operationIndex, inventory, generation, readPieceRows, getReadScope: currentReadScope }), backend: 'artifact', storeId: root, cursorScope: semanticHash('semantic.store-inventory.v1', [...inventory.values()].map(({partitionId, canonicalHash}) => ({partitionId, canonicalHash})).sort((a,b) => a.partitionId < b.partitionId ? -1 : a.partitionId > b.partitionId ? 1 : 0)), verifySource, repoRoot, generation: { ...generation }, getRecords, getSourceReference, getSourceSpans, getCoverage, iterateRows, readMemberRows, getRelatedPage, getNeighbors: createNeighborReader(getRelatedPage) };

};
