import { assertRuntimeQuery } from '../../../contracts/validators/runtime-query.js';
import { semanticHash, canonicalSemanticJson } from '../identity.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { runtimeImportError } from './raw-store.js';
import { openRuntimeQueryFamily } from './query-store.js';

export const defaultRuntimeQuerySelectors = () => ({ captureIds: [], runtime: null, workload: null, scope: null,
  sources: [], records: [], codeVersions: [], evidenceIds: [], kinds: [], joinQualities: [] });
export const DEFAULT_RUNTIME_QUERY_LIMITS = Object.freeze({ maxRecords: 32, maxBytes: 65536, maxMs: 250 });
const cursorError = () => runtimeImportError('Runtime cursor does not match the exact pinned query.', 'ERR_RUNTIME_QUERY_CURSOR');
const cursorFor = (queryId, familyIndex, ordinal) => {
  const value = { version: 1, queryId, familyIndex, ordinal };
  return Buffer.from(canonicalSemanticJson({ ...value, checksum: semanticHash('pairofcleats.runtime.query-cursor.v1', value) })).toString('base64url');
};
const readCursor = (cursor, queryId, familyCount) => {
  if (cursor === null) return { familyIndex: 0, ordinal: 0 };
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw cursorError();
    const value = assertRuntimeQuery('cursor', JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    const { checksum, ...payload } = value;
    if (value.queryId !== queryId || value.familyIndex >= familyCount
      || checksum !== semanticHash('pairofcleats.runtime.query-cursor.v1', payload)) throw cursorError();
    return value;
  } catch { throw cursorError(); }
};
const sameSelected = (selected, actual) => !selected || Object.entries(selected).every(([key, value]) => actual[key] === value);
const selectCapture = (selectors, capture) => (!selectors.captureIds.length || selectors.captureIds.includes(capture.captureId))
  && sameSelected(selectors.runtime, capture.runtime) && sameSelected(selectors.workload, capture.workload)
  && sameSelected(selectors.scope, capture.scope);
const whereFor = (selectors, ordinal) => {
  const conditions = ['e.ordinal>=?'], parameters = [ordinal];
  for (const [values, column] of [[selectors.evidenceIds, 'e.evidence_id'], [selectors.kinds, 'e.kind'], [selectors.joinQualities, 'e.join_quality']]) {
    if (values.length) { conditions.push(column + ' IN (' + values.map(() => '?').join(',') + ')'); parameters.push(...values); }
  }
  if (selectors.sources.length) {
    conditions.push("e.join_quality='exact-source'");
    conditions.push('(' + selectors.sources.map(() => '(e.source_unit_id=? AND e.source_hash=?)').join(' OR ') + ')');
    for (const source of selectors.sources) parameters.push(source.sourceUnitId, source.byteHash);
  }
  if (selectors.records.length) {
    conditions.push('EXISTS(SELECT 1 FROM source_refs r WHERE r.ordinal=e.ordinal AND ('
      + selectors.records.map(() => '(r.partition_id=? AND r.local_id=?)').join(' OR ') + '))');
    for (const ref of selectors.records) parameters.push(ref.partitionId, ref.localId);
  }
  if (selectors.codeVersions.length) {
    conditions.push('(' + selectors.codeVersions.map(() => '(e.session_id=? AND e.process_id=? AND e.code_id=? AND e.lifetime_id=?)').join(' OR ') + ')');
    for (const key of selectors.codeVersions) parameters.push(key.sessionId, key.processId, key.codeId, key.lifetimeId);
  }
  return { clause: conditions.join(' AND '), parameters };
};

const explain = row => {
  const limitations = ['Evidence describes the saved capture and its instrumentation only.'];
  if (row.join.quality !== 'exact-source') limitations.push('Source join quality: ' + row.join.quality + '; no exact source binding is asserted.');
  let statement = 'Saved ' + row.kind + ' observation in this capture.';
  let nextObservation = null;
  if (row.kind === 'cpuProfile') {
    statement = 'Saved Inspector samples attribute ' + row.data.sampleCount + ' samples to profile node ' + row.data.profileNodeId + '.';
    limitations.push('Sampling does not prove all executions, call counts, or optimization causality.');
    nextObservation = { question: 'Does the same function remain sampled in another matching workload phase?',
      evidenceKinds: ['cpuProfile'], expectedInformationGain: 'Separate repeatable workload behavior from one saved sample window.',
      estimatedCost: 'A separately authorized bounded capture is needed if no matching saved profile exists.',
      permissionRequirements: ['Explicit authorization before any new capture or attachment.'], action: 'plan-only', executionAuthorized: false };
  }
  if (row.kind === 'nativeDisassembly') {
    statement = 'The saved versioned interchange associates a native listing hash with this exact code lifetime.';
    limitations.push('The adapter reads a custom saved interchange, not arbitrary native V8 logs; instruction bytes are not hydrated here.');
  }
  if (row.kind === 'codeVersion' || row.kind === 'codeLifecycle') limitations.push('Code identity includes session, process, code ID and lifetime; IDs are never merged across lifetimes.');
  if (row.kind === 'derivedClaim') {
    statement = row.data.claim;
    limitations.push(...row.data.assumptions.slice(0, 8));
  }
  return { evidenceIds: [row.evidenceId], statement, basis: row.evidenceClass === 'observed' ? 'direct-observation' : 'derived-claim', limitations, nextObservation };
};
const responseBytes = result => Buffer.byteLength(JSON.stringify(result));

/** Pure retrieval of explicitly pinned saved families. No execution, probing, collector or attachment API. */
export const queryRuntimeEvidence = async ({ destination, request, signal = null }) => {
  assertRuntimeQuery('request', request);
  request = structuredClone(request);
  throwIfAborted(signal);
  const queryId = semanticHash('pairofcleats.runtime.query.v1', { ...request, cursor: null });
  let position = readCursor(request.cursor, queryId, request.familyGenerations.length);
  const started = Date.now(), deadline = started + request.limits.maxMs;
  const child = new AbortController();
  const onAbort = () => child.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => child.abort(runtimeImportError('Runtime query verification exceeded its time allowance.', 'ERR_RUNTIME_QUERY_BUDGET')), request.limits.maxMs);
  const result = { schemaVersion: 1, queryId, executionAuthorized: false, repositoryNamespace: request.repositoryNamespace,
    generation: request.generation, pinnedFamilies: [], observations: [], derivedClaims: [], explanations: [], coverage: [], omitted: [],
    derivedCoverage: { state: 'unsupported', reason: 'current_saved_adapters_project_direct_observations_only' },
    status: 'complete', warnings: [], nextCursor: null,
    integrity: { manifest: 'verified', queryIndex: 'verified', returnedRows: 'verified', rawArtifacts: 'not-read' },
    cost: { visitedRecords: 0, hydratedRecords: 0, elapsedMs: 0, responseBytes: 0 } };
  const deadlineReached = () => Date.now() >= deadline;
  if (request.selectors.kinds.includes('derivedClaim')) {
    result.status = 'partial'; result.warnings.push('derived_claim_projection_not_supported_by_current_offline_adapters');
  }
  const updateCursor = () => { result.nextCursor = position.familyIndex < request.familyGenerations.length ? cursorFor(queryId, position.familyIndex, position.ordinal) : null; };
  try {
    for (let familyIndex = 0; familyIndex < request.familyGenerations.length; familyIndex += 1) {
      const family = await openRuntimeQueryFamily({ destination, generationId: request.familyGenerations[familyIndex], signal: child.signal });
      try {
        const { capture, manifest } = family;
        if (capture.repositoryNamespace !== request.repositoryNamespace
          || canonicalSemanticJson(capture.generation) !== canonicalSemanticJson(request.generation)) {
          throw runtimeImportError('Pinned runtime capture belongs to another repository or source generation.', 'ERR_RUNTIME_QUERY_SCOPE');
        }
        const selected = selectCapture(request.selectors, capture);
        const sourceJoinCounts = { exactSource: 0, sourceMap: 0, heuristic: 0, ambiguous: 0, unresolved: 0 };
        const qualityFields = { 'exact-source': 'exactSource', 'source-map': 'sourceMap', heuristic: 'heuristic', ambiguous: 'ambiguous', unresolved: 'unresolved' };
        for (const row of family.db.prepare('SELECT join_quality,count(*) AS count FROM evidence GROUP BY join_quality LIMIT 6').all()) {
          if (!qualityFields[row.join_quality]) throw runtimeImportError('Runtime lookup join quality is invalid.');
          sourceJoinCounts[qualityFields[row.join_quality]] = row.count;
        }
        if (Object.values(sourceJoinCounts).reduce((sum, count) => sum + count, 0) !== manifest.evidence.count) throw runtimeImportError('Runtime lookup inventory count mismatch.');
        const reasons = [...new Set(manifest.coverage.flatMap(row => row.reasons))].slice(0, 8).map(reason => reason.slice(0, 256));
        if (selected && request.selectors.sources.length) {
          if (!request.selectors.sources.some(source => capture.sources.some(saved => saved.sourceUnitId === source.sourceUnitId && saved.byteHash === source.byteHash))) {
            reasons.push('requested_source_not_in_capture_snapshot'); result.status = 'partial';
          } else if (!sourceJoinCounts.exactSource) { reasons.push('exact_source_mapping_unavailable_in_saved_capture'); result.status = 'partial'; }
        }
        result.pinnedFamilies.push({ generationId: manifest.generationId, captureId: capture.captureId, manifestHash: family.manifestHash });
        result.coverage.push({ generationId: manifest.generationId, captureId: capture.captureId, completion: capture.completion, selected,
          formats: [...new Set(manifest.raw.map(row => row.format + '@' + row.formatVersion))], importStates: [...new Set(manifest.coverage.map(row => row.status))],
          sourceJoinCounts,
          joinStatus: request.selectors.sources.length ? 'exact-source-requested' : request.selectors.records.length ? 'record-reference-requested' : 'not-filtered',
          reasons });
        if (capture.completion !== 'complete' || manifest.coverage.some(row => row.status !== 'complete')) result.status = 'partial';
        if (familyIndex < position.familyIndex) continue;
        if (result.cost.visitedRecords >= request.limits.maxRecords || deadlineReached()) continue;
        if (position.familyIndex === familyIndex && position.ordinal > manifest.evidence.count) throw cursorError();
        if (!selected) { position = { familyIndex: familyIndex + 1, ordinal: 0 }; continue; }
        const where = whereFor(request.selectors, position.familyIndex === familyIndex ? position.ordinal : 0);
        const remaining = request.limits.maxRecords - result.cost.visitedRecords;
        const entries = family.db.prepare('SELECT e.* FROM evidence e WHERE ' + where.clause + ' ORDER BY e.ordinal LIMIT ?').all(...where.parameters, remaining + 1);
        for (const entry of entries.slice(0, remaining)) {
          if (deadlineReached()) break;
          throwIfAborted(child.signal);
          result.cost.visitedRecords += 1;
          const row = await family.hydrate(entry, request.limits.maxBytes);
          position = { familyIndex, ordinal: entry.ordinal + 1 }; updateCursor();
          if (row) {
            const bucket = row.evidenceClass === 'observed' ? result.observations : result.derivedClaims;
            bucket.push(row); result.explanations.push(explain(row));
            if (responseBytes(result) <= request.limits.maxBytes - 256) result.cost.hydratedRecords += 1;
            else { bucket.pop(); result.explanations.pop(); result.omitted.push({ generationId: manifest.generationId, evidenceId: entry.evidence_id, reason: 'response_byte_allowance' }); result.status = 'partial'; }
          } else { result.omitted.push({ generationId: manifest.generationId, evidenceId: entry.evidence_id, reason: 'row_byte_allowance' }); result.status = 'partial'; }
        }
        if (entries.length <= remaining && !deadlineReached()) position = { familyIndex: familyIndex + 1, ordinal: 0 };
      } finally { await family.close(); }
    }
    if (deadlineReached()) { result.status = 'partial'; result.warnings.push('query_time_allowance_exhausted'); }
    updateCursor();
    result.cost.elapsedMs = Date.now() - started;
    for (let i = 0; i < 4; i += 1) result.cost.responseBytes = responseBytes(result);
    if (result.cost.responseBytes > request.limits.maxBytes) throw runtimeImportError('Runtime response metadata exceeds the byte allowance.', 'ERR_RUNTIME_QUERY_BUDGET');
    throwIfAborted(signal);
    assertRuntimeQuery('result', result);
    return result;
  } catch (error) {
    if (!signal?.aborted && child.signal.aborted && child.signal.reason?.code === 'ERR_RUNTIME_QUERY_BUDGET') throw child.signal.reason;
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
};
