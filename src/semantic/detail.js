import { randomUUID } from 'node:crypto';
import { attachSemanticSourceReferences } from './source-references.js';
import { canonicalSemanticJson, semanticHash } from '../index/semantic/identity.js';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';
import { assertSemanticQuery } from '../contracts/validators/semantic-query.js';
import { throwIfAborted } from '../shared/abort.js';
import { observeStorageResource } from '../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../shared/storage/operation-error.js';
import { readProviderEvidenceEntry, providerEvidenceState, createProviderEvidenceBudget } from './provider-evidence-detail.js';

const fail = (code, message) => Object.assign(new Error(message), { code });
const fieldGroups = ['span', 'scope', 'data'];
const budgetUsage = new WeakMap();
export const getSemanticDetailBudgetUsage = result => budgetUsage.get(result) || { retainedEvidenceBytes: 0 };
const project = (row, fields) => ({ ref: row.ref, id: row.id, kind: row.kind,
  ...Object.fromEntries(fields.map((field) => [field, row[field]])),
  availableFieldGroups: fieldGroups, omittedFieldGroups: fieldGroups.filter((field) => !fields.includes(field)) });
/** Bounded, ID-first detail hydration. Continuations preserve each member offset. */
export const createSemanticDetailService = ({ maxContinuations = 64, ttlMs = 300000,
  maxRecords = 128, maxRows = 512, maxBytes = 65536, maxWorkMs = 250 } = {}) => {
  const maxima = { records: maxRecords, rows: maxRows, bytes: maxBytes, workMs: maxWorkMs };
  for (const [key, hardMax] of Object.entries({ records: 128, rows: 512, bytes: 65536, workMs: 250 })) {
    if (!Number.isSafeInteger(maxima[key]) || maxima[key] < 1 || maxima[key] > hardMax) throw new TypeError('Invalid configured semantic ' + key + ' limit.');
  }
  if (!Number.isSafeInteger(maxContinuations) || maxContinuations < 1 || maxContinuations > 4096 || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 86400000) throw new TypeError('Invalid semantic continuation bounds.');
  const continuations = new Map();
  return async ({ store, request, signal = null }) => {
    assertSemanticQuery('detailRequest', request);
    assertSemanticEnvelope('generation', request.generation);
    if (canonicalSemanticJson(request.generation) !== canonicalSemanticJson(store.generation)) throw fail('ERR_SEMANTIC_GENERATION_MISMATCH', 'Requested semantic generation differs from the pinned store.');
    if (request.repoRoot !== store.repoRoot) throw fail('ERR_SEMANTIC_SCOPE_MISMATCH', 'Requested repository differs from the store scope.');
    const fields = request.fields || fieldGroups;
    const include = request.include || [];
    const limits = { ...maxima, ...request.limits };
    for (const key of Object.keys(maxima)) if (limits[key] > maxima[key]) throw fail('ERR_SEMANTIC_QUERY_LIMIT', 'Requested ' + key + ' exceeds the configured semantic limit.');
    const key = semanticHash('semantic.detail-continuation.v2', { repoRoot: request.repoRoot, generation: request.generation,
      refs: request.refs, fields, include, limits, backend: store.backend || 'custom', storeId: store.storeId || store.repoRoot,
      cursorScope: store.cursorScope || null });
    let state = { index: 0, stage: 'record', offset: 0, nameRef: null, afterName: null, companionDone: false };
    if (request.cursor) {
      const saved = continuations.get(request.cursor);
      if (!saved || saved.key !== key || saved.expires <= Date.now()) throw fail('ERR_SEMANTIC_CURSOR_EXPIRED', 'Restart semantic detail with the pinned generation and original request; continuation is expired or mismatched.');
      state = structuredClone(saved.state);
    }
    const began = performance.now();
    throwIfAborted(signal);
    const result = { schemaVersion: 1, generation: request.generation, status: 'partial', records: [],
      edges: [], operands: [], names: [], ownership: [], evidenceRefs: [],
      coverage: { extraction: [], analysis: [], response: { state: 'partial', returnedCount: 0, hydratedCount: 0 } },
      frontier: [], cursor: null, warnings: [] };
    if (include.includes('providerEvidence')) result.providerEvidence = [];
    const partitions = new Set();
    let hydrated = 0, progressed = false, evidenceReadBytes = 0;
    const fits = () => Buffer.byteLength(JSON.stringify(result)) + evidenceReadBytes + 512 <= limits.bytes;
    const afterRelated = () => include.includes('providerEvidence') ? 'providerEvidence' : 'next';
    const nextRelated = () => { state.offset = 0; state.stage = include.includes('operands') ? 'operands' : include.includes('ownership') ? 'ownership' : afterRelated(); };
    const evidenceBudget = createProviderEvidenceBudget({
      remainingBytes: () => Math.max(0, limits.bytes - Buffer.byteLength(JSON.stringify(result)) - evidenceReadBytes - 512),
      remainingRows: () => Math.max(0, limits.rows - hydrated),
      chargeBytes: count => { evidenceReadBytes += count; }, chargeRows: count => { hydrated += count; }
    });
    const admit = (family, row) => {
      result[family].push(row);
      if (!fits()) { result[family].pop(); return false; }
      return true;
    };
    while (state.index < request.refs.length) {
      throwIfAborted(signal);
      if (progressed && performance.now() - began >= limits.workMs) break;
      const ref = request.refs[state.index];
      if (!partitions.has(ref.partitionId)) {
        // Source coverage remains bounded alongside node hydration.
        if (partitions.size >= 16) break;
        const coverage = await store.getCoverage([ref.partitionId], { signal });
        result.coverage.extraction.push(...coverage.filter((row) => row.phase === 'syntax'));
        result.coverage.analysis.push(...coverage.filter((row) => row.phase !== 'syntax'));
        partitions.add(ref.partitionId);
        if (!fits()) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Coverage envelope exceeds output budget.');
      }
      if (state.stage === 'next') {
        state.index += 1; state.stage = 'record'; state.offset = 0; state.nameRef = null; state.providerRecord = null; progressed = true; continue;
      }
      if (state.stage === 'record') {
        if (result.records.length >= limits.records) break;
        const readFields = (include.includes('names') || include.includes('providerEvidence')) && !fields.includes('data') ? [...fields, 'data'] : fields;
        const [row] = await store.getRecords([ref], readFields, { signal });
        if (!row) {
          result.frontier.push({ ref, reason: 'record_not_found' });
          if (!fits()) { result.frontier.pop(); break; }
          state.stage = 'next'; progressed = true; continue;
        }
        if (!admit('records', project(row, fields))) break;
        state.providerRecord = include.includes('providerEvidence') && row.kind === 'evidence' ? { kind: row.kind, data: row.data } : null;
        progressed = true;
        if (include.includes('names')) {
          if (Number.isSafeInteger(row.data?.nameId)) {
            state.nameRef = { partitionId: ref.partitionId, localId: row.data.nameId };
            state.afterName = 'related'; state.stage = 'name'; state.offset = 0;
          } else if (row.kind === 'expression') { state.stage = 'companions'; state.offset = 0; }
          else nextRelated();
        } else nextRelated();
        continue;
      }
      if (state.stage === 'companions') {
        if (result.records.length >= limits.records || hydrated >= limits.rows) break;
        const page = await store.getRelatedPage(ref, 'semantic_records', { offset: state.offset, limit: 1, signal });
        if (!page.rows.length) { nextRelated(); progressed = true; continue; }
        const row = page.rows[0];
        if (!admit('records', project(row, fields))) break;
        hydrated += 1; progressed = true;
        state.offset = page.offset; state.companionDone = page.done;
        state.nameRef = { partitionId: row.ref.partitionId, localId: row.data.nameId };
        state.afterName = 'companions'; state.stage = 'name';
        continue;
      }
      if (state.stage === 'name') {
        if (hydrated >= limits.rows) break;
        const page = await store.getRelatedPage(state.nameRef, 'semantic_lookup', { limit: 1, signal });
        if (!page.rows.length) throw fail('ERR_SEMANTIC_INTEGRITY', 'An interned semantic name is missing.');
        if (!admit('names', page.rows[0])) break;
        hydrated += 1; progressed = true;
        if (state.afterName === 'companions' && !state.companionDone) state.stage = 'companions';
        else nextRelated();
        continue;
      }
      if (state.stage === 'providerEvidence') {
        if (!state.providerRecord) { state.stage = 'next'; progressed = true; continue; }
        if (hydrated >= limits.rows) break;
        const hadProgress = progressed, remainingMs = limits.workMs - (performance.now() - began);
        const deadline = AbortSignal.timeout(Math.max(1, Math.ceil(remainingMs)));
        const evidenceSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
        let page;
        try {
          if (remainingMs <= 0) throw fail('ERR_SEMANTIC_EVIDENCE_BUDGET', 'Shared evidence work allowance exhausted.');
          page = await readProviderEvidenceEntry({ store, ref, record: state.providerRecord,
            offset: state.offset, budget: evidenceBudget, signal: evidenceSignal });
        } catch (error) {
          const observation = observeStorageResource(error, { phase: 'semantic-provider-evidence' });
          observation.requireSettled();
          throwIfAborted(signal);
          let code, name;
          try { code = error?.code; name = error?.name; }
          catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
          observation.requireSettled();
          const budgetLimited = ['ERR_SEMANTIC_EVIDENCE_BUDGET', 'ERR_FILE_TOO_LARGE'].includes(code)
            || deadline.aborted && (error === deadline.reason || ['AbortError', 'TimeoutError'].includes(name));
          if (!budgetLimited) {
            if (['ENOENT', 'ENOTDIR'].includes(code)) throw addStorageFailureContext(
              fail('ERR_SEMANTIC_INTEGRITY', 'A retained provider evidence artifact or source is missing.'), {},
              observation.retain(), { secondaryPresent: true });
            throw error;
          }
          if (hadProgress) break;
          page = { entry: providerEvidenceState(ref, state.providerRecord, 'shared_page_allowance_exhausted', 'budget'), done: true };
        }
        if (!admit('providerEvidence', page.entry)) break;
        progressed = true;
        state.offset += 1;
        if (page.done) { state.offset = 0; state.stage = 'next'; continue; }
        // Re-reading another raw artifact entry uses a new ordinary detail page,
        // with the same pinned cursor; no hidden independent hydration budget.
        break;
      }
      const family = state.stage;
      if (hydrated >= limits.rows) break;
      const member = family === 'operands' ? 'semantic_operands' : 'semantic_ownership';
      const page = await store.getRelatedPage(ref, member, { offset: state.offset, limit: Math.min(128, limits.rows - hydrated), signal });
      let accepted = 0;
      for (const row of page.rows) {
        throwIfAborted(signal);
        if (!admit(family, row)) break;
        accepted += 1; hydrated += 1; progressed = true;
      }
      state.offset += accepted;
      if (accepted < page.rows.length) break;
      if (!page.done) continue;
      state.offset = 0;
      state.stage = family === 'operands' && include.includes('ownership') ? 'ownership' : afterRelated();
      progressed = true;
    }
    const done = state.index === request.refs.length;
    result.coverage.response = { state: done ? 'complete' : 'partial', returnedCount: result.records.length, hydratedCount: hydrated };
    const analysisComplete = result.coverage.analysis.length > 0 && result.coverage.analysis.every((row) => row.state === 'complete');
    const extractionComplete = result.coverage.extraction.length > 0 && result.coverage.extraction.every((row) => row.state === 'complete');
    result.status = done && analysisComplete && extractionComplete && !result.frontier.length && !result.providerEvidence?.length ? 'complete' : 'partial';
    await attachSemanticSourceReferences({ store, result, signal, began, limits: { ...limits, bytes: limits.bytes - evidenceReadBytes } });
    if (!done) {
      if (!progressed) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Selected semantic row cannot fit the output budget; select fewer field groups.');
      const cursor = randomUUID(), now = Date.now();
      for (const [token, saved] of continuations) if (saved.expires <= now) continuations.delete(token);
      continuations.set(cursor, { key, state: structuredClone(state), expires: now + ttlMs });
      while (continuations.size > maxContinuations) continuations.delete(continuations.keys().next().value);
      result.cursor = cursor;
      result.frontier.push({ reason: 'response_budget', remainingCount: request.refs.length - state.index });
    }
    if (Buffer.byteLength(JSON.stringify(result)) + evidenceReadBytes > limits.bytes) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Semantic response and retained evidence reads exceed the shared page byte budget.');
    assertSemanticQuery('detailResult', result);
    budgetUsage.set(result, { retainedEvidenceBytes: evidenceReadBytes });
    return result;
  };
};
