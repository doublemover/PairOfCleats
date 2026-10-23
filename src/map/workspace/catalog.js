import { openPublishedSemanticStore } from '../../semantic/published-store.js';
import { SEMANTIC_MEMBER_NAMES } from '../../contracts/schemas/semantic-envelopes.js';
import { createHash, randomUUID } from 'node:crypto';
import { getIndexDir } from '../../shared/repo-paths.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { loadPiecesManifest } from '../../shared/artifact-io/manifest.js';
import { loadJsonArrayArtifactRows, loadJsonObjectArtifact } from '../../shared/artifact-io/loaders/core.js';
import { ARTIFACT_SCHEMA_DEFS, MANIFEST_ONLY_ARTIFACT_NAMES } from '../../contracts/schemas/artifacts.js';
import { createAbortError, throwIfAborted } from '../../shared/abort.js';
import { combineMapReadCleanupFailure } from '../shared/read-outcome.js';
import { captureMapGraphSelection, mapGraphSelectionKey, openMapGraphReader, closeMapGraphReader } from './graph-reader.js';
import { captureSceneResource } from '../isometric/client/scene-retirement.js';
import { captureSceneFailure } from '../isometric/client/scene-failure-inspection.js';
const MAX_READ_BYTES = 2 * 1024 * 1024;
const arraySchema = schema => schema?.type === 'array' || schema?.anyOf?.some(item => item.type === 'array');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const classify = name => /^(semantic|symbolic)/.test(name) ? 'semantic' : /^(symbols|symbol_|call_sites|graph_|file_relations)/.test(name) ? 'relations'
  : /risk|flow/.test(name) ? 'risk' : /dense_|token_|minhash|vocab|postings/.test(name) ? 'retrieval'
    : /chunk_|file_meta|repo_map|vfs|extraction/.test(name) ? 'source' : 'index';
export const artifactInventory = () => [...new Set([...Object.keys(ARTIFACT_SCHEMA_DEFS), ...MANIFEST_ONLY_ARTIFACT_NAMES])].sort().map(name => ({
  name, family: classify(name), logicalSchema: Boolean(ARTIFACT_SCHEMA_DEFS[name]),
  mode: MANIFEST_ONLY_ARTIFACT_NAMES.includes(name) ? 'metadata' : arraySchema(ARTIFACT_SCHEMA_DEFS[name]) ? 'rows' : 'object'
}));
async function* semanticRows(dir, repoRoot, name, signal) {
  const { store, manifest } = await openPublishedSemanticStore({ indexDir: dir, repoRoot });
  for (const partition of manifest.partitions) {
    for await (const row of store.iterateRows(partition.partitionId, name, { signal })) {
      yield { partitionId: partition.partitionId, generation: manifest.generation, family: name, row,
        ...(name === 'semantic_records' ? { ref: { partitionId: partition.partitionId, localId: row.id } } : {}) };
    }
  }
}
/** Owns at most eight sequential readers. No expanded graph, source index or unlimited history is cached. */
export function createArtifactBrowser({
  clock = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout,
  withGraphCapability,
  openRows = ({ dir, repoRoot, name, manifest, signal }) => SEMANTIC_MEMBER_NAMES.includes(name)
    ? semanticRows(dir, repoRoot, name, signal)
    : loadJsonArrayArtifactRows(dir, name, { maxBytes: MAX_READ_BYTES, manifest, strict: true, signal })
} = {}) {
  const readers = new Map(), entries = new Set(), operations = new Set();
  let closed = false, closing = null, idleTimer = null, cleanupFailure, cleanupFailed = false;
  const recordCleanup = error => { if (!cleanupFailed) { cleanupFailed = true; cleanupFailure = error; } };
  const ensureOpen = () => {
    if (closed) throw Object.assign(new Error('Artifact browser is closed.'), { status: 503 });
    if (cleanupFailed) throw Object.assign(new Error('Artifact reader cleanup failed; close this service.'), { status: 503, cause: cleanupFailure });
  };
  const closeEntry = (entry, { hasPrimary = false, primaryError } = {}) => {
    entry.controller?.abort(createAbortError('Artifact reader closed.'));
    for (const [key, saved] of readers) if (saved === entry) readers.delete(key);
    if (!entry.closing) entry.closing = Promise.resolve().then(async () => {
      let cleanup, failed = false;
      try { if (entry.iteratorOwner) await entry.iteratorOwner.retireAsync(); else if (entry.returnMethod) await Reflect.apply(entry.returnMethod, entry.iterator, []); }
      catch (error) { cleanup = error; failed = true; }
      if (entry.graph) {
        const original = failed && hasPrimary ? combineMapReadCleanupFailure(primaryError, [cleanup], { hasPrimary: true, terminal: true })
          : failed ? cleanup : primaryError;
        try { await closeMapGraphReader(entry.graph, { hasPrimary: hasPrimary || failed, primaryError: original }); }
        catch (error) { cleanup = failed ? combineMapReadCleanupFailure(cleanup, [error], { hasPrimary: true, terminal: true }) : error; failed = true; }
      }
      if (failed) throw cleanup;
    })
      .catch(error => { recordCleanup(error); throw error; })
      .finally(() => entries.delete(entry));
    return entry.closing;
  };
  const prune = async () => {
    const expired = [...readers.values()].filter(entry => clock() - entry.touched >= 60000);
    const results = await Promise.allSettled(expired.map(closeEntry));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  };
  const armExpiry = () => {
    if (idleTimer) clearTimer(idleTimer);
    idleTimer = null;
    if (closed || !readers.size) return;
    const delay = Math.max(1, Math.min(...[...readers.values()].map(entry => 60000 - (clock() - entry.touched))));
    idleTimer = setTimer(() => {
      idleTimer = null;
      prune().catch(() => {}).finally(armExpiry);
    }, delay);
    idleTimer?.unref?.();
  };
  const run = async (signal, action) => {
    ensureOpen();
    const controller = new AbortController();
    const abort = () => { const reason = signal?.reason; controller.abort(reason === undefined ? createAbortError() : reason); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const operation = { controller, promise: null };
    operation.promise = Promise.resolve().then(async () => {
      ensureOpen(); throwIfAborted(controller.signal);
      await prune(); ensureOpen(); throwIfAborted(controller.signal);
      return action(controller.signal);
    });
    operations.add(operation);
    try { return await operation.promise; }
    finally { operations.delete(operation); signal?.removeEventListener('abort', abort); armExpiry(); }
  };
  const resolve = (repoRoot, graph = null) => {
    const dir = graph ? graph.capability.indexDir : getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
    const manifest = loadPiecesManifest(dir, { maxBytes: MAX_READ_BYTES, strict: true, repoRoot });
    return { dir, manifest, generation: graph ? hash({ manifest, capabilityId: graph.capability.capabilityId, buildId: graph.capability.buildId }) : hash(manifest) };
  };
  const openSelection = async (repoRoot, input, signal) => {
    const selection = captureMapGraphSelection(input);
    if (!selection) return { current: resolve(repoRoot), graph: null, selection: null };
    let graph;
    try { graph = await openMapGraphReader(repoRoot, selection, { signal, withCapability: withGraphCapability }); }
    catch (error) { if (!captureSceneFailure(error).released()) recordCleanup(error); throw error; }
    try { return { current: resolve(repoRoot, graph), graph, selection }; }
    catch (error) {
      try { await closeMapGraphReader(graph, { hasPrimary: true, primaryError: error }); }
      catch (cleanup) { recordCleanup(cleanup); throw combineMapReadCleanupFailure(error, [cleanup], { hasPrimary: true, terminal: true }); }
      throw error;
    }
  };
  const graphFields = graph => graph ? { selection: graph.selection, graphCapability: {
    capability: 'graph', status: 'ready', capabilityId: graph.capability.capabilityId,
    buildId: graph.capability.buildId, indexDir: graph.capability.indexDir
  } } : {};
  const finishSelection = async (scope, action) => {
    let primaryError, hasPrimary = false, result;
    try { result = await action(scope.current); } catch (error) { primaryError = error; hasPrimary = true; }
    if (scope.graph) try { await closeMapGraphReader(scope.graph, { hasPrimary, primaryError }); }
    catch (cleanup) { recordCleanup(cleanup); throw combineMapReadCleanupFailure(primaryError, [cleanup], { hasPrimary, terminal: true }); }
    if (hasPrimary) throw primaryError;
    return result;
  };
  return {
    get cleanupFailed() { return cleanupFailed; },
    get cleanupFailure() { return cleanupFailure; },
    close() {
      if (!closing) {
        closed = true;
        if (idleTimer) clearTimer(idleTimer);
        idleTimer = null;
        for (const operation of operations) operation.controller.abort(createAbortError('Artifact browser closed.'));
        closing = (async () => {
          await Promise.allSettled([...operations].map(operation => operation.promise));
          const results = await Promise.allSettled([...entries].map(closeEntry));
          const failure = results.find(result => result.status === 'rejected');
          if (failure) throw failure.reason;
          if (cleanupFailed) throw cleanupFailure;
        })();
      }
      return closing;
    },
    catalog(repoRoot, signal = null, selection = {}) { return run(signal, async signal => {
      const scope = await openSelection(repoRoot, selection, signal);
      return finishSelection(scope, async ({ manifest, generation }) => {
        const byName = new Map();
        for (const piece of manifest.pieces) { if (!byName.has(piece.name)) byName.set(piece.name, []); byName.get(piece.name).push(piece); }
        const inventory = artifactInventory();
        for (const name of byName.keys()) if (!inventory.some(item => item.name === name)) inventory.push({ name, family: classify(name), logicalSchema: false, mode: 'metadata' });
        return { kind: 'artifact-catalog', generation, ...graphFields(scope.graph), artifactSurfaceVersion: manifest.artifactSurfaceVersion,
          artifacts: inventory.map(item => ({ ...item, available: byName.has(item.name), pieces: (byName.get(item.name) || []).length,
            bytes: byName.has(item.name) && byName.get(item.name).every(piece => Number.isFinite(piece.bytes))
              ? byName.get(item.name).reduce((sum, piece) => sum + piece.bytes, 0) : null })),
          warnings: ['Physical binary stores and offsets expose manifest provenance, not fabricated graph geometry.', 'Reads are capped at 2 MiB per artifact input; use semantic/search query services for larger stores.',
            ...(scope.graph ? ['Validated graph capability does not establish optional-backend, search or current-generation health.'] : [])] };
      });
    }); },
    read(repoRoot, { name, generation, cursor = null, ...selectionInput }, signal = null) { return run(signal, async signal => {
      const selection = captureMapGraphSelection(selectionInput), selectionKey = mapGraphSelectionKey(selection);
      let entry = cursor ? readers.get(cursor) : null;
      if (cursor && !entry) throw Object.assign(new Error('Artifact cursor expired. Reopen the artifact.'), { status: 410 });
      if (entry && (entry.repoRoot !== repoRoot || entry.name !== name || entry.generation !== generation || entry.selectionKey !== selectionKey)) throw Object.assign(new Error('Cursor scope mismatch.'), { status: 403 });
      let scope = entry ? null : await openSelection(repoRoot, selectionInput, signal);
      const currentGraph = entry ? entry.graph : scope.graph;
      let primaryError, hasPrimary = false;
      try {
        const current = entry ? resolve(repoRoot, currentGraph) : scope.current;
        if (generation !== current.generation) throw Object.assign(new Error('Index generation changed. Refresh the catalog.'), { status: 409 });
        const descriptor = artifactInventory().find(item => item.name === name);
        const pieces = current.manifest.pieces.filter(piece => piece.name === name);
        if (!pieces.length) throw Object.assign(new Error('Artifact absent from this generation.'), { status: 404 });
        if (descriptor?.mode === 'metadata' || !descriptor) return { kind: 'artifact-page', generation, ...graphFields(currentGraph), name, mode: 'metadata', rows: pieces, cursor: null, warnings: ['Inspect logical/query output for semantic values.'] };
        if (descriptor.mode === 'object') {
          const value = await loadJsonObjectArtifact(current.dir, name, { maxBytes: MAX_READ_BYTES, manifest: current.manifest, strict: true });
          throwIfAborted(signal);
          if (resolve(repoRoot, currentGraph).generation !== generation) throw Object.assign(new Error('Generation changed during read.'), { status: 409 });
          if (Buffer.byteLength(JSON.stringify(value)) > MAX_READ_BYTES) throw new Error('Artifact exceeds bounded view admission.');
          return { kind: 'artifact-page', generation, ...graphFields(currentGraph), name, mode: 'object', value, cursor: null, provenance: pieces };
        }
        if (cursor) {
          readers.delete(cursor); // A page token is single-use, including concurrent duplicate clicks.
          scope = null; // The original entry continues to own its backend callback.
        } else {
          while (entries.size >= 8) {
            const oldest = readers.values().next().value;
            if (!oldest) throw Object.assign(new Error('Artifact reader capacity is busy.'), { status: 503 });
            await closeEntry(oldest); throwIfAborted(signal);
          }
          const controller = new AbortController();
          entry = { repoRoot, name, generation, ordinal: 0, controller, graph: scope.graph, selectionKey,
            iterator: openRows({ dir: current.dir, repoRoot, name, manifest: current.manifest,
              signal: controller.signal })[Symbol.asyncIterator]() };
          entries.add(entry);
          scope = null; // Transfer only after the original iterator is captured.
          try {
            if (entry.graph) { entry.iteratorOwner = captureSceneResource(entry.iterator, 'original graph artifact iterator', 'return', [], { required: true }); entry.iteratorOwner.assertCaptured(); }
            else entry.returnMethod = entry.iterator.return;
            entry.nextMethod = entry.iterator.next;
            if (typeof entry.nextMethod !== 'function') throw new TypeError('Artifact iterator has no original next method.');
          } catch (error) {
            entry.iteratorOwner?.retainFailure(error);
            try { await closeEntry(entry, { hasPrimary: true, primaryError: error }); }
            catch (cleanup) { throw combineMapReadCleanupFailure(error, [cleanup], { hasPrimary: true, terminal: true }); }
            throw error;
          }
        }
        const abortEntry = () => { const reason = signal.reason; entry.controller.abort(reason === undefined ? createAbortError() : reason); };
        signal.addEventListener('abort', abortEntry, { once: true });
        if (signal.aborted) abortEntry();
        const rows = []; let bytes = 0, done = false, completing = false;
        try {
          while (rows.length < 128) {
            throwIfAborted(signal);
            const next = entry.pending || await Reflect.apply(entry.nextMethod, entry.iterator, []); entry.pending = null;
            throwIfAborted(signal);
            if (next.done) { done = true; break; }
            const size = Buffer.byteLength(JSON.stringify(next.value));
            if (size > 65536) throw new Error('One artifact row exceeds the 64 KiB page budget. Use a field-projected query.');
            if (bytes + size > 65536) { entry.pending = next; break; }
            rows.push(next.value); bytes += size;
          }
          if (resolve(repoRoot, entry.graph).generation !== generation) throw Object.assign(new Error('Generation changed during read.'), { status: 409 });
          const ordinal = entry.ordinal; entry.ordinal += rows.length;
          let nextCursor = null;
          if (!done) {
            nextCursor = randomUUID(); entry.touched = clock(); readers.set(nextCursor, entry);
          } else { completing = true; await closeEntry(entry); }
          return { kind: 'artifact-page', generation, ...graphFields(entry.graph), name, mode: 'rows', rows, ordinal, cursor: nextCursor,
            coverage: { returned: rows.length, total: null, state: done ? 'complete' : 'partial' }, provenance: pieces.slice(0, 20) };
        } catch (error) {
          if (completing) throw error; // The only failure was terminal completion cleanup.
          entry.iteratorOwner?.retainFailure(error);
          try { await closeEntry(entry, { hasPrimary: true, primaryError: error }); }
          catch (cleanup) { throw combineMapReadCleanupFailure(error, [cleanup], { hasPrimary: true, terminal: true }); }
          throw error;
        }
        finally { signal.removeEventListener('abort', abortEntry); }
      } catch (error) {
        primaryError = error; hasPrimary = true;
        if (entry?.graph && !entry.closing && scope === null) {
          entry.iteratorOwner?.retainFailure(error);
          try { await closeEntry(entry, { hasPrimary: true, primaryError: error }); }
          catch (cleanup) { throw combineMapReadCleanupFailure(error, [cleanup], { hasPrimary: true, terminal: true }); }
        }
        throw error;
      }
      finally {
        if (scope?.graph) try { await closeMapGraphReader(scope.graph, { hasPrimary, primaryError }); }
        catch (cleanup) { recordCleanup(cleanup); throw combineMapReadCleanupFailure(primaryError, [cleanup], { hasPrimary, terminal: true }); }
      }
    }); }
  };
}
