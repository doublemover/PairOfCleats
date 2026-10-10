import { advanceTraceContext } from './trace-context.js';
import { randomUUID } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../index/semantic/identity.js';
import { assertSemanticTrace } from '../contracts/validators/semantic-trace.js';
import { throwIfAborted } from '../shared/abort.js';
const fail = (code, message) => Object.assign(new Error(message), { code });
export const DEFAULT_TRACE_KINDS = Object.freeze('defines reads writes mutates returns captures flowsTo argumentToParameter returnToResult sharesStorage copies packs transfers dispatches consumes'.split(' '));
const refKey = ref => canonicalSemanticJson(ref);
const visitKey = (ref, stack = []) => canonicalSemanticJson({ ref, stack });
/** Bounded source-pinned traversal; continuations retain only refs and member offsets. */
export const createSemanticTraceService = ({ maxRecords = 128, maxEdges = 512, maxDepth = 64,
  maxBytes = 65536, maxWorkMs = 250, maxContinuations = 64, ttlMs = 300000 } = {}) => {
  const maxima = { records: maxRecords, edges: maxEdges, depth: maxDepth, bytes: maxBytes, workMs: maxWorkMs };
  for (const [key, hard] of Object.entries({ records: 128, edges: 512, depth: 64, bytes: 65536, workMs: 250 })) if (!Number.isSafeInteger(maxima[key]) || maxima[key] < 1 || maxima[key] > hard) throw new TypeError('Invalid semantic trace ' + key + ' limit.');
  if (!Number.isSafeInteger(maxContinuations) || maxContinuations < 1 || maxContinuations > 4096 || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 86400000) throw new TypeError('Invalid semantic trace continuation bounds.');
  const continuations = new Map();
  return async ({ store, request, signal = null }) => {
    assertSemanticTrace('request', request);
    throwIfAborted(signal);
    if (canonicalSemanticJson(request.generation) !== canonicalSemanticJson(store.generation)) throw fail('ERR_SEMANTIC_GENERATION_MISMATCH', 'Requested trace generation differs from pinned store.');
    if (request.repoRoot !== store.repoRoot) throw fail('ERR_SEMANTIC_SCOPE_MISMATCH', 'Requested repository differs from store scope.');
    const limits = { ...maxima, depth: Math.min(4, maxDepth), ...request.limits };
    for (const name of Object.keys(maxima)) if (limits[name] > maxima[name]) throw fail('ERR_SEMANTIC_QUERY_LIMIT', 'Requested ' + name + ' exceeds configured semantic limit.');
    const kinds = request.kinds || DEFAULT_TRACE_KINDS;
    const key = semanticHash('semantic.trace-continuation.v1', { ...request, cursor: null, limits, kinds, backend: store.backend || 'custom', storeId: store.storeId || store.repoRoot, inventory: store.cursorScope || null });
    let state = { queue: [{ ref: request.seed, depth: 0, traverse: true }], seen: [visitKey(request.seed)], index: 0,
      truncated: false, analysisIncomplete: false, stage: request.slot ? request.slot.name === 'output' ? 'output' : 'slot' : 'record', offset: 0 };
    if (request.cursor) {
      const saved = continuations.get(request.cursor);
      if (!saved || saved.key !== key || saved.expires <= Date.now()) throw fail('ERR_SEMANTIC_CURSOR_EXPIRED', 'Trace continuation expired or differs from the pinned request/store.');
      state = structuredClone(saved.state);
    }
    const seen = new Set(state.seen), pageCoverage = new Set();
    const result = { schemaVersion: 1, generation: request.generation, status: 'partial', records: [], edges: [], operands: [], names: [], ownership: [], evidenceRefs: [],
      coverage: { extraction: [], analysis: [], response: { state: 'partial', returnedCount: 0, hydratedCount: 0 } }, frontier: [], cursor: null, warnings: [] };
    let progressed = false, reason = 'response_budget';
    const began = performance.now();
    const fits = () => Buffer.byteLength(JSON.stringify(result)) + 1024 <= limits.bytes;
    const admit = (family, row) => { result[family].push(row); if (fits()) return true; result[family].pop(); return false; };
    const next = () => { state.index += 1; state.stage = 'record'; state.offset = 0; progressed = true; };
    const enqueue = (ref, depth, traverse, stack = []) => {
      const identity = visitKey(ref, stack);
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
        if (pageCoverage.size >= 16) break;
        const coverage = await store.getCoverage([ref.partitionId], { signal });
        for (const row of coverage) {
          const target = row.phase === 'syntax' ? result.coverage.extraction : result.coverage.analysis;
          if (!target.some(existing => canonicalSemanticJson(existing) === canonicalSemanticJson(row))) target.push(row);
        }
        if (!coverage.some(row => row.phase === 'syntax') || !coverage.some(row => row.phase !== 'syntax') || coverage.some(row => row.state !== 'complete')) state.analysisIncomplete = true;
        pageCoverage.add(ref.partitionId);
        if (!fits()) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Trace source coverage exceeds response budget.');
      }
      if (state.stage === 'record') {
        if (result.records.length >= limits.records) break;
        const [row] = await store.getRecords([ref], ['span', 'scope', 'data'], { signal });
        if (!row) { state.truncated = true; if (!admit('frontier', { ref, reason: 'record_not_found' })) break; next(); continue; }
        if (!admit('records', row)) break;
        progressed = true;
        if (!item.traverse) { next(); continue; }
        if (item.depth >= limits.depth) { state.truncated = true; result.frontier.push({ ref, reason: 'depth_budget' }); next(); continue; }
        state.stage = 'edges'; state.offset = 0;
      }
      if (result.edges.length >= limits.edges) break;
      const page = await store.getNeighbors(ref, request.direction, kinds, { offset: state.offset, limit: 1, signal });
      if (page.edges.length) {
        const edge = page.edges[0];
        const context = advanceTraceContext(item.stack || [], edge, request.direction);
        if (context.skip || context.frontier) {
          if (context.frontier) { state.truncated = true; result.frontier.push({ ref, reason: context.frontier }); }
          state.offset = page.offset; progressed = true; if (page.done) next(); continue;
        }
        if (!admit('edges', edge)) break;
        enqueue(request.direction === 'downstream' ? edge.to : edge.from, item.depth + 1, true, context.stack);
        if (edge.evidence) {
          if (!result.evidenceRefs.some(value => refKey(value) === refKey(edge.evidence))) result.evidenceRefs.push(edge.evidence);
          enqueue(edge.evidence, item.depth, false);
        }
      }
      state.offset = page.offset; progressed = true;
      if (page.done) next();
    }
    const done = state.index === state.queue.length;
    result.coverage.response = { state: done && !state.truncated ? 'complete' : 'partial', returnedCount: result.records.length, hydratedCount: result.edges.length + result.operands.length };
    const complete = result.coverage.extraction.length > 0 && result.coverage.extraction.every(row => row.state === 'complete')
      && result.coverage.analysis.length > 0 && result.coverage.analysis.every(row => row.state === 'complete');
    if (!complete || state.analysisIncomplete) { result.warnings.push('Source analysis includes unavailable or incomplete phases; coverage retains every physical partition.'); result.frontier.push({ reason: 'analysis_incomplete' }); }
    result.status = done && !state.truncated && !state.analysisIncomplete && complete && !result.frontier.length ? 'complete' : 'partial';
    if (!done) {
      if (!progressed) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Selected trace row cannot fit the response budget.');
      const now = Date.now();
      for (const [token, saved] of continuations) if (saved.expires <= now) continuations.delete(token);
      const cursor = randomUUID();
      continuations.set(cursor, { key, state: structuredClone(state), expires: now + ttlMs });
      while (continuations.size > maxContinuations) continuations.delete(continuations.keys().next().value);
      result.cursor = cursor; result.frontier.push({ reason, remainingCount: state.queue.length - state.index });
    }
    if (Buffer.byteLength(JSON.stringify(result)) > limits.bytes) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Trace response exceeds byte budget.');
    return assertSemanticTrace('result', result);
  };
};
