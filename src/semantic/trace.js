import { advanceTraceContext } from './trace-context.js';
import { attachSemanticSourceReferences } from './source-references.js';
import { randomUUID } from 'node:crypto';
import { createSemanticCoverageQualification, qualifySemanticCoverage, semanticCoverageIsComplete, semanticCoverageWarning } from './coverage-qualification.js';
import { canonicalSemanticJson, semanticHash } from '../index/semantic/identity.js';
import { assertSemanticTrace } from '../contracts/validators/semantic-trace.js';
import { throwIfAborted } from '../shared/abort.js';
import { captureSemanticRequest } from './request-snapshot.js';
import { SEMANTIC_TRACE_REQUEST_SCHEMA } from '../contracts/schemas/semantic-trace.js';
import { semanticTracePathDeclaration, semanticPathExecution } from './path-capabilities.js';
import { inspectSemanticPathEdge } from './path-edge.js';
import { stageSemanticPagePublication } from './page-publication.js';
import { createTraceTraversalState, createTraceContinuationBudget, isTraceContinuationBudget } from './trace-continuation-state.js';
const fail = (code, message) => Object.assign(new Error(message), { code });
export const DEFAULT_TRACE_KINDS = Object.freeze('defines reads writes mutates returns captures flowsTo argumentToParameter returnToResult sharesStorage copies packs transfers dispatches consumes'.split(' '));
const refKey = ref => canonicalSemanticJson(ref);
const visitKey = (ref, stack = [], traverse = true) => canonicalSemanticJson({ ref, stack, traverse });
/** Bounded source-pinned traversal; continuations retain only refs and member offsets. */
export const createSemanticTraceService = ({ maxRecords = 128, maxEdges = 512, maxDepth = 64,
  maxBytes = 65536, maxWorkMs = 250, maxContinuations = 64, ttlMs = 300000, operation = 'semantic_trace',
  finalizeResult = null, maxStateBytes = 8 * 1024 * 1024, maxContinuationBytes = 32 * 1024 * 1024,
  retentionBudget = null } = {}) => {
  if (!['semantic_trace', 'semantic_explain'].includes(operation)) throw new TypeError('Invalid semantic trace operation identity.');
  if (finalizeResult !== null && typeof finalizeResult !== 'function') throw new TypeError('Invalid semantic page finalizer.');
  const maxima = { records: maxRecords, edges: maxEdges, depth: maxDepth, bytes: maxBytes, workMs: maxWorkMs };
  for (const [key, hard] of Object.entries({ records: 128, edges: 512, depth: 64, bytes: 65536, workMs: 250 })) if (!Number.isSafeInteger(maxima[key]) || maxima[key] < 1 || maxima[key] > hard) throw new TypeError('Invalid semantic trace ' + key + ' limit.');
  if (!Number.isSafeInteger(maxContinuations) || maxContinuations < 1 || maxContinuations > 4096 || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 86400000) throw new TypeError('Invalid semantic trace continuation bounds.');
  if (!Number.isSafeInteger(maxStateBytes) || maxStateBytes < 1024 || maxStateBytes > 64 * 1024 * 1024
    || !Number.isSafeInteger(maxContinuationBytes) || maxContinuationBytes < maxStateBytes || maxContinuationBytes > 256 * 1024 * 1024) {
    throw new TypeError('Invalid semantic trace state/retention byte bounds.');
  }
  if (retentionBudget !== null && !isTraceContinuationBudget(retentionBudget)) throw new TypeError('Invalid semantic trace aggregate retention owner.');
  retentionBudget ||= createTraceContinuationBudget({ maxBytes: maxContinuationBytes });
  const continuations = new Map();
  let continuationBytes = 0, disposed = false, lastPageWork = null;
  const removeContinuation = cursor => continuations.get(cursor)?.lease.release();
  // This factory scope has no page/store/result locals. A retained budget
  // callback must not close over a publication activation's hydrated response.
  const installContinuation = (cursor, pending) => {
    if (disposed) throw fail('ERR_SEMANTIC_CURSOR_EXPIRED', 'Trace service retired before continuation publication.');
    if (pending.bytes > retentionBudget.stats().maxBytes) {
      throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Trace continuation exceeds the aggregate retention byte allowance.');
    }
    const now = Date.now();
    for (const [token, saved] of continuations) if (saved.expires <= now) removeContinuation(token);
    while (continuations.size >= maxContinuations || continuationBytes + pending.bytes > maxContinuationBytes) removeContinuation(continuations.keys().next().value);
    const saved = { ...pending, expires: now + ttlMs, lease: null };
    saved.lease = retentionBudget.retain(saved.bytes, saved.expires, () => {
      if (continuations.get(cursor) === saved) { continuations.delete(cursor); continuationBytes -= saved.bytes; }
    });
    continuations.set(cursor, saved); continuationBytes += saved.bytes;
  };
  const trace = async ({ store, request, signal = null }, began) => {
    if (disposed) throw fail('ERR_SEMANTIC_CURSOR_EXPIRED', 'Trace service was retired.');
    retentionBudget.sweep();
    assertSemanticTrace('request', request);
    throwIfAborted(signal);
    if (canonicalSemanticJson(request.generation) !== canonicalSemanticJson(store.generation)) throw fail('ERR_SEMANTIC_GENERATION_MISMATCH', 'Requested trace generation differs from pinned store.');
    if (request.repoRoot !== store.repoRoot) throw fail('ERR_SEMANTIC_SCOPE_MISMATCH', 'Requested repository differs from store scope.');
    const limits = { ...maxima, depth: Math.min(4, maxDepth), ...request.limits };
    for (const name of Object.keys(maxima)) if (limits[name] > maxima[name]) throw fail('ERR_SEMANTIC_QUERY_LIMIT', 'Requested ' + name + ' exceeds configured semantic limit.');
    const kinds = request.kinds || DEFAULT_TRACE_KINDS;
    const declaration = semanticTracePathDeclaration(request.pathSemantics, operation);
    if (request.pathSemantics && (typeof store.cursorScope !== 'string' || !store.cursorScope.length)) {
      throw fail('ERR_SEMANTIC_UNAVAILABLE', 'Path validation requires an exact pinned inventory identity.');
    }
    const key = semanticHash('semantic.trace-continuation.v3', { ...request, cursor: null, operation, declaration,
      statePolicy: 'persistent-avl-fifo-v1', maxStateBytes,
      limits, kinds, backend: store.backend || 'custom', storeId: store.storeId || store.repoRoot, inventory: store.cursorScope || null });
    let state = { traversal: null,
      truncated: false, qualification: createSemanticCoverageQualification(), stage: request.slot ? request.slot.name === 'output' ? 'output' : 'slot' : 'record', offset: 0 };
    if (request.cursor) {
      const saved = continuations.get(request.cursor);
      if (!saved || saved.key !== key || saved.expires <= Date.now()) throw fail('ERR_SEMANTIC_CURSOR_EXPIRED', 'Trace continuation expired or differs from the pinned request/store.');
      state = { ...saved.state };
    }
    const traversal = createTraceTraversalState({ checkpoint: state.traversal, maxBytes: maxStateBytes });
    if (!state.traversal) traversal.reset({ ref: request.seed, depth: 0, traverse: true }, visitKey(request.seed));
    const pageCoverage = new Set();
    const result = { schemaVersion: 1, generation: request.generation, status: 'partial', records: [], edges: [], operands: [], names: [], ownership: [], evidenceRefs: [],
      coverage: { extraction: [], analysis: [], response: { state: 'partial', returnedCount: 0, hydratedCount: 0 } }, frontier: [], cursor: null, warnings: [] };
    if (request.pathSemantics) result.pathCapability = semanticPathExecution({ declaration, store, request, limits, kinds });
    let progressed = false, reason = 'response_budget';
    const fits = () => Buffer.byteLength(JSON.stringify(result)) + 1024 <= limits.bytes;
    const admit = (family, row) => { result[family].push(row); if (fits()) return true; result[family].pop(); return false; };
    const next = () => { traversal.shift(); state.stage = 'record'; state.offset = 0; progressed = true; };
    const enqueue = (ref, depth, traverse, stack = []) => {
      const identity = visitKey(ref, stack, traverse);
      if (traversal.enqueue({ ref, depth, traverse, stack }, identity) === 'budget') {
        state.truncated = true; result.frontier.push({ ref, reason: 'visited_budget' });
      }
    };
    while (traversal.size) {
      throwIfAborted(signal);
      if (progressed && performance.now() - began >= limits.workMs) { reason = 'work_budget'; break; }
      const item = traversal.peek(), ref = item.ref;
      if (state.stage === 'output') {
        const [seed] = await store.getRecords([ref], ['data'], { signal });
        const output = seed?.kind === 'expression' ? ref : seed?.kind === 'occurrence' ? seed.data.expression : null;
        if (!output) { state.truncated = true; result.frontier.push({ ref, reason: 'slot_unavailable' }); next(); continue; }
        traversal.reset({ ref: output, depth: 0, traverse: true }, visitKey(output));
        state.stage = 'record'; progressed = true; continue;
      }
      if (state.stage === 'slot') {
        const page = await store.getRelatedPage(ref, 'semantic_operands', { offset: state.offset, limit: 1, signal });
        const slot = request.slot.name === 'input' ? 'argument' : request.slot.name;
        const selected = page.rows.find(row => row.slot === slot && row.ordinal === request.slot.ordinal);
        if (selected?.child) {
          if (!admit('operands', selected)) break;
          traversal.reset({ ref: selected.child, depth: 0, traverse: true }, visitKey(selected.child));
          state.stage = 'record'; state.offset = 0; progressed = true; continue;
        }
        state.offset = page.offset; progressed = true;
        if (page.done) { state.truncated = true; result.frontier.push({ ref, reason: 'slot_unavailable' }); next(); }
        continue;
      }
      if (!pageCoverage.has(ref.partitionId)) {
        if (pageCoverage.size >= 16) { if (request.pathSemantics) reason = 'partition_budget'; break; }
        const coverage = await store.getCoverage([ref.partitionId], { signal });
        for (const row of coverage) {
          const target = row.phase === 'syntax' ? result.coverage.extraction : result.coverage.analysis;
          if (!target.some(existing => canonicalSemanticJson(existing) === canonicalSemanticJson(row))) target.push(row);
        }
        state.qualification = qualifySemanticCoverage(state.qualification, coverage);
        pageCoverage.add(ref.partitionId);
        if (!fits()) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Trace source coverage exceeds response budget.');
      }
      if (state.stage === 'record') {
        if (result.records.length >= limits.records) { if (request.pathSemantics) reason = 'record_budget'; break; }
        const [row] = await store.getRecords([ref], ['span', 'scope', 'data'], { signal });
        if (!row) { state.truncated = true; if (!admit('frontier', { ref, reason: 'record_not_found' })) break; next(); continue; }
        if (!admit('records', row)) break;
        progressed = true;
        if (!item.traverse) { next(); continue; }
        if (item.depth >= limits.depth) { state.truncated = true; result.frontier.push({ ref, reason: 'depth_budget' }); next(); continue; }
        state.stage = 'edges'; state.offset = 0;
      }
      if (result.edges.length >= limits.edges) { if (request.pathSemantics) reason = 'edge_budget'; break; }
      const batched = store.getNeighbors.supportsPositions === true;
      const page = await store.getNeighbors(ref, request.direction, kinds, {
        offset: state.offset, limit: batched ? Math.min(64, limits.edges - result.edges.length) : 1, signal
      });
      const entries = batched ? page.entries : [{ edge: page.edges[0] || null, offset: page.offset }];
      let paused = false;
      for (const entry of entries) {
        if (request.pathSemantics && progressed && performance.now() - began >= limits.workMs) { reason = 'work_budget'; paused = true; break; }
        const edge = entry.edge;
        if (edge) {
          const inspected = request.pathSemantics ? await inspectSemanticPathEdge({ store, edge, owner: ref,
            direction: request.direction, kinds, semantics: declaration.semantics, signal }) : { traverse: true };
          const context = declaration.semantics === 'balanced-call-value' && inspected.traverse
            ? advanceTraceContext(item.stack || [], edge, request.direction) : { stack: item.stack || [] };
          const previousFrontier = result.frontier.length, previouslyTruncated = state.truncated;
          const frontier = context.frontier || inspected.frontier;
          if (frontier && !context.skip) {
            if (!admit('frontier', { ref, reason: frontier })) { paused = true; break; }
            state.truncated = true;
          }
          if (!context.skip && !context.frontier) {
            if (!admit('edges', edge)) {
              result.frontier.length = previousFrontier; state.truncated = previouslyTruncated; paused = true; break;
            }
            if (inspected.traverse) enqueue(request.direction === 'downstream' ? edge.to : edge.from, item.depth + 1, true, context.stack);
            if (edge.evidence) {
              if (!result.evidenceRefs.some(value => refKey(value) === refKey(edge.evidence))) result.evidenceRefs.push(edge.evidence);
              enqueue(edge.evidence, item.depth, false);
            }
          }
        }
        state.offset = entry.offset;
        progressed = true;
      }
      if (paused) break;
      if (page.done) next();
    }
    const done = traversal.size === 0;
    result.coverage.response = { state: done && !state.truncated ? 'complete' : 'partial', returnedCount: result.records.length, hydratedCount: result.edges.length + result.operands.length };
    const complete = semanticCoverageIsComplete(state.qualification);
    if (!complete) { result.warnings.push('Source analysis includes unavailable or incomplete phases; coverage retains every physical partition.',
      semanticCoverageWarning(state.qualification)); result.frontier.push({ reason: 'analysis_incomplete' }); }
    result.status = done && !state.truncated && complete && !result.frontier.length ? 'complete' : 'partial';
    await attachSemanticSourceReferences({ store, result, signal, began, limits });
    let pendingContinuation = null;
    if (!done) {
      if (!progressed) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Selected trace row cannot fit the response budget.');
      const cursor = randomUUID();
      pendingContinuation = { key, state: Object.freeze({ ...state, traversal: traversal.snapshot(),
        qualification: Object.freeze({ ...state.qualification }) }), bytes: traversal.logicalBytes };
      result.cursor = cursor; result.frontier.push({ reason, remainingCount: traversal.size });
    }
    lastPageWork = traversal.stats();
    throwIfAborted(signal);
    if (Buffer.byteLength(JSON.stringify(result)) > limits.bytes) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Trace response exceeds byte budget.');
    assertSemanticTrace('result', result, { operation });
    return { result, pendingContinuation, began };
  };
  // A continuation owns only refs/offsets; each page opens a fresh bounded read
  // scope and disposes its verified owners before returning or throwing.
  const service = async args => {
    const began = performance.now();
    const captured = { ...args, request: captureSemanticRequest(args.request, SEMANTIC_TRACE_REQUEST_SCHEMA) };
    const readPage = async () => {
      const page = await trace(captured, began);
      if (finalizeResult) page.result = await finalizeResult(page.result, captured, page.began);
      throwIfAborted(captured.signal);
      return page;
    };
    const { result, pendingContinuation } = await (typeof captured.store?.withReadScope === 'function'
      ? captured.store.withReadScope(readPage) : readPage());
    throwIfAborted(captured.signal);
    const cursor = result.cursor;
    return stageSemanticPagePublication(result, () => {
      throwIfAborted(captured.signal);
      if (pendingContinuation) installContinuation(cursor, pendingContinuation);
    }, captured.deferPublication);
  };
  return Object.freeze(Object.assign(service, {
    dispose() { disposed = true; for (const cursor of continuations.keys()) removeContinuation(cursor); },
    continuationStats: () => Object.freeze({ serviceRetainedBytes: continuationBytes, serviceCursors: continuations.size,
      maxStateBytes, maxContinuationBytes, lastPageWork, aggregate: retentionBudget.stats() })
  }));
};
