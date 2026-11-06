import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { captureSemanticRequest } from '../request-snapshot.js';
import { REPOSITORY_QUERY_REQUEST_SCHEMA } from '../../contracts/schemas/repository-question-live.js';
import { assertRepositoryQuery } from '../../contracts/validators/repository-question-live.js';
import { REPOSITORY_QUESTION_VERSION } from '../../contracts/schemas/repository-question.js';
import { createSemanticCoverageQualification, semanticCoverageIsComplete } from '../coverage-qualification.js';
import { createSemanticContinuationBudget, isSemanticContinuationBudget } from '../continuation-budget.js';
import { stageSemanticPagePublication } from '../page-publication.js';
import { compileRepositoryQuestion, QUESTION_PREDICATES } from './compile.js';
import { admitCurrentReaderQuestion, describeQuestionWorld, CURRENT_READER_QUESTION_PROFILE, normalizeQuestionScan } from './current-reader-profile.js';
import { createCurrentQuestionFacts } from './current-reader-facts.js';

const fail = (code, message) => Object.assign(new Error(message), { code });
const BASE_STATE_BYTES = 65536;
const createSeed = ref => ({ ref, phase: 'admit', operandOffset: 0, edgeOffset: 0, occurrenceOffset: 0,
  occurrence: null, occurrenceDone: false, sawOperand: false, source: null, targets: [], literals: [], outer: 0, inner: 0 });
const initialState = () => ({ path: null, pathAfter: null, pathIndex: 0, pathDone: false, sourcesDone: false, after: null,
  seed: null, retainedBytes: BASE_STATE_BYTES, emitted: 0, unknown: false, unresolved: 0, done: false,
  lastCoverageSourceUnit: null, qualification: createSemanticCoverageQualification() });
const retirement = (continuations, token) => () => continuations.delete(token);
// Factory outside the page activation: retained callbacks cannot keep hydrated
// rows, a native store, a reader scope or the current response alive.
const publication = (owner, token, entry, signal) => () => {
  throwIfAborted(signal);
  if (entry) owner.install(token, entry);
};

/** Current-reader conjunction executor. A bounded Invocation candidate set is
 * collected before source sorting; its Cartesian output is streamed, not built.
 * Oversized per-Invocation state fails explicitly and never drops alternatives.
 */
export const createRepositoryQuestionService = ({ maxRecords = 128, maxBytes = 65536, maxWorkMs = 250,
  maxContinuations = 64, ttlMs = 300000, maxStateBytes = 8 * 1024 * 1024, retentionBudget = null } = {}) => {
  const maxima = { records: maxRecords, bytes: maxBytes, workMs: maxWorkMs };
  for (const [name, upper, lower] of [['records', 128, 1], ['bytes', 65536, 1], ['workMs', 250, 1]]) {
    if (!Number.isSafeInteger(maxima[name]) || maxima[name] < lower || maxima[name] > upper) throw new TypeError('Invalid repository query ' + name + ' allowance.');
  }
  if (!Number.isSafeInteger(maxContinuations) || maxContinuations < 1 || maxContinuations > 4096
    || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 86400000
    || !Number.isSafeInteger(maxStateBytes) || maxStateBytes < BASE_STATE_BYTES || maxStateBytes > 8 * 1024 * 1024) throw new TypeError('Invalid repository query cursor allowance.');
  if (retentionBudget !== null && !isSemanticContinuationBudget(retentionBudget)) throw new TypeError('Original semantic continuation budget required.');
  retentionBudget ||= createSemanticContinuationBudget();
  const continuations = new Map(); let disposed = false;
  const owner = { install(token, entry) {
    if (disposed) throw fail('ERR_SEMANTIC_CURSOR_EXPIRED', 'Repository query service retired; restart the original question.');
    // Admission precedes local eviction. Releasing an uninstalled provisional
    // page must not retire a previously delivered cursor.
    const expires = Date.now() + ttlMs;
    const lease = retentionBudget.retain(entry.state.retainedBytes, expires, retirement(continuations, token));
    continuations.set(token, { ...entry, expires, lease });
    while (continuations.size > maxContinuations) continuations.get(continuations.keys().next().value).lease.release();
  } };
  const run = async ({ store, request, signal, began }) => {
    throwIfAborted(signal);
    if (request.repoRoot !== store.repoRoot) throw fail('ERR_SEMANTIC_SCOPE_MISMATCH', 'Repository query scope differs from the opened reader.');
    if (canonicalSemanticJson(request.generation) !== canonicalSemanticJson(store.generation)) throw fail('ERR_SEMANTIC_GENERATION_MISMATCH', 'Repository query generation differs from the opened reader.');
    if (request.mode === 'describe') {
      store.assertSourceOrderAvailable?.({ signal });
      const result = assertRepositoryQuery('description', {
        schemaVersion: REPOSITORY_QUESTION_VERSION, kind: 'repository-question-capabilities', profile: CURRENT_READER_QUESTION_PROFILE,
        world: describeQuestionWorld(store, normalizeQuestionScan(request.scan)),
        predicates: Object.entries(QUESTION_PREDICATES).map(([id, value]) => ({ id, version: value.version, meaning: value.meaning })),
        liveFragment: 'one Invocation, one Declaration, one Literal; conjunctive target/argument producers and pure filters; select all three, Invocation first',
        sourceDomain: 'expression-bearing-retained-sources', programSemantics: 'not-established'
      });
      if (Buffer.byteLength(JSON.stringify(result)) + 1 > maxBytes) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Question capability description exceeds the configured response allowance.');
      return { result, entry: null };
    }
    const plan = compileRepositoryQuestion(request.question);
    if (plan.status !== 'compiled') throw Object.assign(fail('ERR_SEMANTIC_QUERY_CONTRACT', 'Repository question compilation rejected the requested clauses.'), { diagnostics: plan.diagnostics });
    const profile = admitCurrentReaderQuestion(plan, store);
    if (typeof store.findOperationsInSourceOrder !== 'function' || typeof store.listOperationSourcePaths !== 'function') throw fail('ERR_SEMANTIC_UNAVAILABLE', 'Rebuild a generation with indexed source-order readers.');
    store.assertSourceOrderAvailable?.({ signal });
    const limits = { ...maxima, ...request.limits };
    for (const name of Object.keys(maxima)) if (limits[name] > maxima[name]) throw fail('ERR_SEMANTIC_QUERY_LIMIT', 'Repository query limit exceeds configured ' + name + '.');
    const key = semanticHash('repository-question.cursor.v1', { request: { ...request, cursor: null }, limits, maxStateBytes,
      inventory: store.cursorScope, storeId: store.storeId || store.repoRoot, backend: store.backend || 'custom' }, { maxBytes: 512 * 1024 });
    retentionBudget.sweep();
    const saved = request.cursor ? continuations.get(request.cursor) : null;
    if (request.cursor && (!saved || saved.key !== key || saved.expires <= Date.now())) throw fail('ERR_SEMANTIC_CURSOR_EXPIRED', 'Question cursor expired or belongs to another request, generation, backend or input inventory. Restart the original question.');
    const state = saved ? structuredClone(saved.state) : initialState();
    const result = { schemaVersion: REPOSITORY_QUESTION_VERSION, kind: 'repository-question-indexed-page', profile: CURRENT_READER_QUESTION_PROFILE,
      world: profile.world, requestDigest: plan.requestDigest, logicalPlanId: plan.logicalPlanId, physicalPlanId: plan.physicalPlanId,
      status: 'partial', rows: [], originMap: plan.originMap, frontier: [], refutations: [], frontierOmitted: 0, refutationsOmitted: 0,
      completion: { enumeration: 'partial', analysis: 'unobserved', programSemantics: 'not-established', rankedPrefix: 'not-established' },
      counts: { returnedRows: 0, emittedThroughCursor: state.emitted, unresolvedThroughCursor: state.unresolved, totalInRetainedRelation: null, programTotal: null },
      verification: 'retained-records-and-source-headers', supportSelection: 'one-deterministic-witness-per-row', diagnosticSelection: 'bounded-observed-clause-failures',
      cursor: randomUUID(), work: { steps: 0, elapsedMs: 0, retainedStateBytes: state.retainedBytes } };
    if (Buffer.byteLength(JSON.stringify(result)) + 2048 > limits.bytes) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Question world and clause metadata exceed this response allowance.');
    const diagnose = (kind, operatorId, reason, ref = null) => {
      if (kind === 'unknown') { state.unknown = true; state.unresolved++; }
      const family = kind === 'refuted' ? 'refutations' : 'frontier', rows = result[family];
      const value = { operatorId, reason, ...(ref ? { ref } : {}) };
      if (rows.length === 64) { result[family + 'Omitted']++; return; }
      rows.push(value);
      if (Buffer.byteLength(JSON.stringify(result)) + 2048 > limits.bytes) { rows.pop(); result[family + 'Omitted']++; }
    };
    let facts = state.seed ? createCurrentQuestionFacts({ store, profile, state, signal, diagnose, maxStateBytes }) : null;
    let progressed = false;
    while (!state.done && result.work.steps < 512 && (!progressed || performance.now() - began < limits.workMs)) {
      throwIfAborted(signal);
      if (state.seed) {
        if (state.seed.phase === 'emit') {
          const value = await facts.row();
          result.rows.push(value);
          if (Buffer.byteLength(JSON.stringify(result)) + 2048 > limits.bytes) {
            result.rows.pop();
            if (!progressed) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'One qualified question row exceeds this page allowance; increase the page byte limit or expand the individual records through semantic detail.');
            break;
          }
          facts.consumeRow();
          if (result.rows.length === limits.records) { progressed = true; result.work.steps++; break; }
        } else if (state.seed.phase === 'done') {
          state.seed = null; facts = null; state.retainedBytes = BASE_STATE_BYTES;
        } else await facts.advance();
      } else if (state.path !== null && state.pathDone) {
        state.path = null; state.after = null; state.pathDone = false;
        if (profile.compiled.scan.sourcePaths) state.pathIndex++;
      } else if (state.path === null) {
        const scan = profile.compiled.scan;
        if (scan.sourcePaths) {
          if (state.pathIndex === scan.sourcePaths.length) state.done = true;
          else state.path = scan.sourcePaths[state.pathIndex];
        } else if (state.sourcesDone) state.done = true;
        else {
          const page = await store.listOperationSourcePaths({ prefix: scan.sourcePrefix, after: state.pathAfter, limit: 1 }, { signal });
          if (page.paths.length > 1 || !page.done && !page.paths.length) throw fail('ERR_SEMANTIC_INTEGRITY', 'Source enumeration failed bounded progress.');
          state.sourcesDone = page.done;
          if (page.paths.length) { state.path = page.paths[0]; state.pathAfter = page.after; }
          else state.done = true;
        }
      } else {
        const page = await store.findOperationsInSourceOrder(state.path, { after: state.after, limit: 1, signal });
        if (page.refs.length > 1 || !page.done && !page.refs.length) throw fail('ERR_SEMANTIC_INTEGRITY', 'Ordered operation reader failed bounded progress.');
        state.pathDone = page.done; state.after = page.after;
        if (page.refs.length) {
          state.seed = createSeed(page.refs[0]);
          facts = createCurrentQuestionFacts({ store, profile, state, signal, diagnose, maxStateBytes });
        }
      }
      result.work.steps++; progressed = true;
    }
    throwIfAborted(signal);
    if (state.done) result.cursor = null;
    else diagnose('remainder', null, 'page-work-or-output-budget');
    if (state.unknown && !result.frontier.length) diagnose('remainder', null, 'prior-pages-contain-unresolved-bindings');
    result.completion.enumeration = state.done ? 'complete-in-retained-input' : 'partial';
    result.completion.analysis = !state.qualification.observed ? 'unobserved' : semanticCoverageIsComplete(state.qualification) ? 'complete' : 'incomplete';
    if (state.done && !state.unknown) { result.status = 'complete-in-retained-input'; result.counts.totalInRetainedRelation = state.emitted; }
    result.counts.returnedRows = result.rows.length; result.counts.emittedThroughCursor = state.emitted;
    result.counts.unresolvedThroughCursor = state.unresolved;
    result.work.elapsedMs = performance.now() - began; result.work.retainedStateBytes = state.retainedBytes;
    if (Buffer.byteLength(JSON.stringify(result)) + 1 > limits.bytes) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Repository question response exceeds its admitted byte allowance.');
    assertRepositoryQuery('page', result);
    return { result, entry: result.cursor ? { key, state } : null };
  };
  const service = async args => {
    const began = performance.now();
    const request = captureSemanticRequest(args.request, REPOSITORY_QUERY_REQUEST_SCHEMA);
    assertRepositoryQuery('request', request); throwIfAborted(args.signal);
    if (disposed) throw fail('ERR_SEMANTIC_CURSOR_EXPIRED', 'Repository query service retired.');
    const captured = { store: args.store, request, signal: args.signal, began };
    const { result, entry } = await (typeof args.store?.withReadScope === 'function'
      ? args.store.withReadScope(() => run(captured)) : run(captured));
    throwIfAborted(args.signal);
    return stageSemanticPagePublication(result, publication(owner, result.cursor, entry, args.signal), args.deferPublication);
  };
  service.dispose = () => { disposed = true; for (const value of [...continuations.values()]) value.lease.release(); };
  service.continuationStats = () => ({ cursors: continuations.size, ...retentionBudget.stats() });
  return service;
};
