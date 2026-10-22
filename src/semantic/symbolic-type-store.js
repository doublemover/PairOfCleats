import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadPiecesManifest } from '../shared/artifact-io/manifest-read.js';
import { checksumString } from '../shared/hash.js';
import { composeAbortSignals, throwIfAborted } from '../shared/abort.js';
import { resolveSemanticPartPath } from './artifact-store.js';
import { containsTypeIr, classifyTypeIr } from '../index/tooling/typescript/type-ir/index.js';
import { createSymbolicTypeGraph, normalizeSymbolicTypeRef, validateSymbolicTypeManifest,
  symbolicTypeError } from '../shared/symbolic-types.js';
import { SYMBOLIC_TYPE_GRAPH_MAX_BYTES, SYMBOLIC_TYPE_TOTAL_MAX_BYTES } from '../contracts/schemas/symbolic-types.js';

/** Read only the admitted size from an opened immutable-generation file. */
const readBoundedFile = async (filePath, maxBytes, signal) => {
  const handle = await fs.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    if (!Number.isSafeInteger(size) || size > maxBytes) throw symbolicTypeError('symbolic_type_limit', 'Symbolic artifact exceeds its read allowance.');
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      throwIfAborted(signal);
      const read = await handle.read(bytes, offset, Math.min(size - offset, 65536), null);
      if (!read.bytesRead) throw symbolicTypeError('symbolic_type_corrupt', 'Symbolic artifact changed during read.');
      offset += read.bytesRead;
    }
    if ((await handle.read(Buffer.alloc(1), 0, 1, null)).bytesRead) throw symbolicTypeError('symbolic_type_corrupt', 'Symbolic artifact grew during read.');
    return bytes;
  } finally { await handle.close(); }
};
const readJson = bytes => {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw symbolicTypeError('symbolic_type_corrupt', 'Invalid symbolic artifact JSON.'); }
};
const readRegisteredFile = async (indexDir, relativePath, maxBytes, signal) => {
  try { return await readBoundedFile(await resolveSemanticPartPath(indexDir, relativePath), maxBytes, signal); }
  catch (error) {
    if (error?.code === 'ENOENT') throw symbolicTypeError('symbolic_type_missing', 'A registered symbolic artifact is missing.');
    if (error?.code === 'ERR_SEMANTIC_INTEGRITY') throw symbolicTypeError('symbolic_type_corrupt', 'A symbolic artifact path is outside its generation.');
    throw error;
  }
};
const verifyPieceChecksum = async (piece, bytes) => {
  const expected = piece.checksum;
  const actual = expected?.startsWith('sha256:')
    ? 'sha256:' + createHash('sha256').update(bytes).digest('hex')
    : await checksumString(bytes).then(value => value.algo + ':' + value.value);
  if (expected !== actual || (piece.bytes != null && piece.bytes !== bytes.length)) {
    throw symbolicTypeError('symbolic_type_corrupt', 'Registered symbolic artifact checksum/size mismatch.');
  }
};

/** Open the registered family at the caller's exact generation, including legacy semantic-disabled builds. */
export const openPublishedSymbolicTypeStore = async ({ indexDir, repoRoot, generation, signal = null }) => {
  throwIfAborted(signal);
  const pieces = loadPiecesManifest(indexDir, { repoRoot, maxBytes: 2 * 1024 * 1024 });
  const manifestPieces = pieces.pieces.filter(piece => piece.name === 'symbolic_type_manifest');
  if (manifestPieces.length !== 1 || manifestPieces[0].path !== 'symbolic_type_manifest.json') {
    throw symbolicTypeError('symbolic_type_missing', 'The pinned generation has no complete registered symbolic type family.');
  }
  const manifestPiece = manifestPieces[0];
  const manifestBytes = await readRegisteredFile(indexDir, manifestPiece.path, 2 * 1024 * 1024, signal);
  await verifyPieceChecksum(manifestPiece, manifestBytes);
  const manifest = validateSymbolicTypeManifest(readJson(manifestBytes));
  if (!generation || manifest.generation.baseBuildId !== generation.baseBuildId
    || manifest.generation.semanticRevision !== generation.semanticRevision || pieces.buildId !== generation.baseBuildId) {
    throw symbolicTypeError('symbolic_type_generation_mismatch', 'Symbolic types do not belong to the requested build generation.');
  }
  const descriptors = new Map();
  const contexts = new Set();
  let totalBytes = 0;
  for (const descriptor of manifest.graphs) {
    if (descriptors.has(descriptor.graphId) || contexts.has(descriptor.contextKey) || descriptor.graphId !== 'stg1:' + descriptor.hash
      || descriptor.path !== 'symbolic-types/' + descriptor.hash + '.json') {
      throw symbolicTypeError('symbolic_type_corrupt', 'Symbolic manifest has conflicting graph identities.');
    }
    totalBytes += descriptor.bytes;
    if (totalBytes > SYMBOLIC_TYPE_TOTAL_MAX_BYTES) throw symbolicTypeError('symbolic_type_limit', 'Symbolic family exceeds its total allowance.');
    const matches = pieces.pieces.filter(piece => piece.name === 'symbolic_type_graph' && piece.path === descriptor.path);
    if (matches.length !== 1) throw symbolicTypeError('symbolic_type_missing', 'A symbolic graph is not registered in the pinned generation.');
    descriptors.set(descriptor.graphId, { descriptor, piece: matches[0] });
    contexts.add(descriptor.contextKey);
  }
  // Retain at most one hydrated context; the flat source buffer is released after admission.
  let active = null;
  const resolve = async (raw, options) => {
    throwIfAborted(options.signal);
    const ref = normalizeSymbolicTypeRef(raw);
    const found = descriptors.get(ref.graphId);
    if (!found) throw symbolicTypeError('symbolic_type_missing', 'Referenced graph is absent from the pinned generation.');
    if (found.descriptor.contextKey !== ref.contextKey) throw symbolicTypeError('symbolic_type_corrupt', 'Symbolic reference context mismatch.');
    if (active?.graphId !== ref.graphId) {
      active = null;
      const bytes = await readRegisteredFile(indexDir, found.descriptor.path, SYMBOLIC_TYPE_GRAPH_MAX_BYTES, options.signal);
      await verifyPieceChecksum(found.piece, bytes);
      if (bytes.length !== found.descriptor.bytes
        || createHash('sha256').update(bytes).digest('hex') !== found.descriptor.hash) {
        throw symbolicTypeError('symbolic_type_corrupt', 'Symbolic graph content checksum mismatch.');
      }
      let hydrated;
      const entry = createSymbolicTypeGraph(readJson(bytes), { ...options,
        budget: { ...options.budget, maxInputChars: 1000000 }, onHydrated: value => { hydrated = value; } });
      if (entry.graphId !== ref.graphId || entry.graph.contextKey !== ref.contextKey
        || entry.graph.nodes.length !== found.descriptor.nodeCount) throw symbolicTypeError('symbolic_type_corrupt', 'Symbolic graph descriptor mismatch.');
      active = { graphId: ref.graphId, ...hydrated };
    }
    const node = active.arena.getNode(ref.nodeId);
    if (!node) throw symbolicTypeError('symbolic_type_missing', 'Referenced symbolic node is absent from its graph.');
    return { ref, arena: active.arena, node };
  };
  throwIfAborted(signal);
  return {
    generation: Object.freeze({ ...manifest.generation }),
    async query(query, options = {}) {
      const operationOptions = { ...options, signal: composeAbortSignals(signal, options.signal) };
      throwIfAborted(operationOptions.signal);
      // Pin operation inputs before the awaited immutable read; the reference
      // normalizer independently owns the selected graph/node identity.
      const { operation, value } = query;
      const { ref, arena, node } = await resolve(query.ref, operationOptions);
      throwIfAborted(operationOptions.signal);
      if (operation === 'membership') return { ref, operation: 'membership',
        contains: containsTypeIr(arena, node, value, operationOptions), complete: true };
      if (operation === 'classify') return { ref, operation: 'classify', ...classifyTypeIr(arena, node, operationOptions) };
      throw symbolicTypeError('symbolic_type_unsupported', 'Unsupported required symbolic type query.');
    }
  };
};
