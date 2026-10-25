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
const fail = (code, message) => Object.assign(new Error(message), { code });
export const DEFAULT_TRACE_KINDS = Object.freeze('defines reads writes mutates returns captures flowsTo argumentToParameter returnToResult sharesStorage copies packs transfers dispatches consumes'.split(' '));
const refKey = ref => canonicalSemanticJson(ref);
const visitKey = (ref, stack = [], traverse = true) => canonicalSemanticJson({ ref, stack, traverse });
/** Bounded source-pinned traversal; continuations retain only refs and member offsets. */
export const createSemanticTraceService = ({ maxRecords = 128, maxEdges = 512, maxDepth = 64,
  maxBytes = 65536, maxWorkMs = 250, maxContinuations = 64, ttlMs = 300000, operation = 'semantic_trace',
  finalizeResult = null } = {}) => {
  if (!['semantic_trace', 'semantic_explain'].includes(operation)) throw new TypeError('Invalid semantic trace operation identity.');
  if (finalizeResult !== null && typeof finalizeResult !== 'function') throw new TypeError('Invalid semantic page finalizer.');
  const maxima = { records: maxRecords, edges: maxEdges, depth: maxDepth, bytes: maxBytes, workMs: maxWorkMs };
  for (const [key, hard] of Object.entries({ records: 128, edges: 512, depth: 64, bytes: 65536, workMs: 250 })) if (!Number.isSafeInteger(maxima[key]) || maxima[key] < 1 || maxima[key] > hard) throw new TypeError('Invalid semantic trace ' + key + ' limit.');
  if (!Number.isSafeInteger(maxContinuations) || maxContinuations < 1 || maxContinuations > 4096 || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 86400000) throw new TypeError('Invalid semantic trace continuation bounds.');
  const continuations = new Map();
  const trace = async ({ store, request, signal = null }) => {
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
    const key = semanticHash('semantic.trace-continuation.v2', { ...request, cursor: null, operation, declaration,
      limits, kinds, backend: store.backend || 'custom', storeId: store.storeId || store.repoRoot, inventory: store.cursorScope || null });
    let state = { queue: [{ ref: request.seed, depth: 0, traverse: true }], seen: [visitKey(request.seed)], index: 0,
      truncated: false, qualification: createSemanticCoverageQualification(), stage: request.slot ? request.slot.name === 'output' ? 'output' : 'slot' : 'record', offset: 0 };
    if (request.cursor) {
      const saved = continuations.get(request.cursor);
      if (!saved || saved.key !== key || saved.expires <= Date.now()) throw fail('ERR_SEMANTIC_CURSOR_EXPIRED', 'Trace continuation expired or differs from the pinned request/store.');
      state = structuredClone(saved.state);
    }
    const seen = new Set(state.seen), pageCoverage = new Set();
    const result = { schemaVersion: 1, generation: request.generation, status: 'partial', records: [], edges: [], operands: [], names: [], ownership: [], evidenceRefs: [],
      coverage: { extraction: [], analysis: [], response: { state: 'partial', returnedCount: 0, hydratedCount: 0 } }, frontier: [], cursor: null, warnings: [] };
    if (request.pathSemantics) result.pathCapability = semanticPathExecution({ declaration, store, request, limits, kinds });
    let progressed = false, reason = 'response_budget';
    const began = performance.now();
    const fits = () => Buffer.byteLength(JSON.stringify(result)) + 1024 <= limits.bytes;
    const admit = (family, row) => { result[family].push(row); if (fits()) return true; result[family].pop(); return false; };
    const next = () => { state.index += 1; state.stage = 'record'; state.offset = 0; progressed = true; };
    const enqueue = (ref, depth, traverse, stack = []) => {
      const identity = visitKey(ref, stack, traverse);
      if (seen.has(identity)) return;
      if (seen.size >= 16384) { state.truncated = true; result.frontier.push({ ref, reason: 'visited_budget' }); return; }
      seen.add(identity); state.seen.push(identity); state.queue.push({ ref, depth, traverse, stack });
    };
    while (state.index < state.queue.length) {
      throwIfAborted(signal);
      if (progressed && performance.now() - began >= limits.workMs) { reason = 'work_budget'; break; }
      const item = state.queue[state.index], ref = item.ref;
      if (state.stage === 'output') {
        const [seed] = await store.getRecords([ref], ['data'], { signal });
        const output = seed?.kind === 'expression' ? ref : seed?.kind === 'occurrence' ? seed.data.expression : null;
        if (!output) { state.truncated = true; result.frontier.push({ ref, reason: 'slot_unavailable' }); next(); continue; }
        state.queue = [{ ref: output, depth: 0, traverse: true }]; state.seen = [visitKey(output)]; seen.clear(); seen.add(visitKey(output));
        state.stage = 'record'; progressed = true; continue;
      }
      if (state.stage === 'slot') {
        const page = await store.getRelatedPage(ref, 'semantic_operands', { offset: state.offset, limit: 1, signal });
        const slot = request.slot.name === 'input' ? 'argument' : request.slot.name;
        const selected = page.rows.find(row => row.slot === slot && row.ordinal === request.slot.ordinal);
        if (selected?.child) {
          if (!admit('operands', selected)) break;
          state.queue = [{ ref: selected.child, depth: 0, traverse: true }]; state.seen = [visitKey(selected.child)]; seen.clear(); seen.add(visitKey(selected.child));
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
    const done = state.index === state.queue.length;
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
      pendingContinuation = { key, state: structuredClone(state) };
      result.cursor = cursor; result.frontier.push({ reason, remainingCount: state.queue.length - state.index });
    }
    throwIfAborted(signal);
    if (Buffer.byteLength(JSON.stringify(result)) > limits.bytes) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Trace response exceeds byte budget.');
    assertSemanticTrace('result', result, { operation });
    return { result, pendingContinuation, began };
  };
  // A continuation owns only refs/offsets; each page opens a fresh bounded read
  // scope and disposes its verified owners before returning or throwing.
  return async args => {
    const captured = { ...args, request: captureSemanticRequest(args.request, SEMANTIC_TRACE_REQUEST_SCHEMA) };
    const readPage = async () => {
      const page = await trace(captured);
      if (finalizeResult) page.result = await finalizeResult(page.result, captured, page.began);
      throwIfAborted(captured.signal);
      return page;
    };
    const { result, pendingContinuation } = await (typeof captured.store?.withReadScope === 'function'
      ? captured.store.withReadScope(readPage) : readPage());
    throwIfAborted(captured.signal);
    return stageSemanticPagePublication(result, () => {
      throwIfAborted(captured.signal);
      if (pendingContinuation) {
        const now = Date.now();
        for (const [token, saved] of continuations) if (saved.expires <= now) continuations.delete(token);
        continuations.set(result.cursor, { ...pendingContinuation, expires: now + ttlMs });
        while (continuations.size > maxContinuations) continuations.delete(continuations.keys().next().value);
      }
    }, captured.deferPublication);
  };
};
