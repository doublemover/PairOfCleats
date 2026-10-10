import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readJsonlRowsAt, validateOffsetsAgainstFile } from '../shared/artifact-io/offsets.js';
import { throwIfAborted } from '../shared/abort.js';
import { assertCurrentIndexFormat } from '../contracts/index-format.js';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';
import { validateSemanticRecord } from '../contracts/validators/semantic.js';

const FAMILY = {
  semantic_records: 'node', semantic_operands: 'operand', semantic_edges: 'edge',
  semantic_ownership: 'ownership', semantic_coverage: 'coverage'
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
  root, repoRoot, artifactSurfaceVersion, generation, partitions,
  maxRecords = 128, maxRecordBytes = 1048576, validationCacheEntries = 64
}) => {
  assertCurrentIndexFormat({
    operation: 'semantic_detail', component: 'semantic family', foundVersion: artifactSurfaceVersion,
    repoRoot, indexPath: root
  });
  assertSemanticEnvelope('generation', generation);
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
  return { generation: { ...generation }, getRecords, getSourceSpans, iterateRows };

};
