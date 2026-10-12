import { assertRuntimeClaims } from '../../../contracts/validators/runtime-claims.js';
import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { openRuntimeQueryFamily } from './query-store.js';
import { runtimeImportError } from './raw-store.js';
import { persistRuntimeDerivedClaims, runtimeClaimsBudget } from './claims.js';
import { runtimeCaptureCompatibility } from './compatibility.js';

const same = (a, b) => canonicalSemanticJson(a) === canonicalSemanticJson(b);
const location = row => canonicalSemanticJson({ sourceUnitId: row.join.sourceUnitId, sourceHash: row.join.sourceHash,
  targets: row.join.targets, lineNumber: row.data.lineNumber, columnNumber: row.data.columnNumber,
  coordinateConvention: row.data.coordinateConvention });

/** Descriptive saved sample counts only. Names, code IDs, timestamps and duration never establish cross-capture equivalence. */
export const compareRuntimeCaptures = async ({ destination, request, signal = null }) => {
  assertRuntimeClaims('compareRequest', request); request = structuredClone(request);
  const check = runtimeClaimsBudget(request.limits, signal), families = [];
  try {
    for (const generationId of [request.leftFamily, request.rightFamily]) {
      check(); families.push(await openRuntimeQueryFamily({ destination, generationId, signal: check.signal }));
    }
    for (const family of families) {
      if (family.capture.repositoryNamespace !== request.repositoryNamespace || !same(family.capture.generation, request.generation)) {
        throw runtimeImportError('Comparison family source generation or repository differs.', 'ERR_RUNTIME_QUERY_SCOPE');
      }
    }
    const pins = families.map((family, index) => ({ generationId: index ? request.rightFamily : request.leftFamily,
      captureId: family.capture.captureId, manifestHash: family.manifestHash }));
    const result = { schemaVersion: 1, executionAuthorized: false, repositoryNamespace: request.repositoryNamespace,
      generation: request.generation, status: 'complete', reasons: [], pinnedFamilies: pins, claims: [], claimGeneration: null };
    result.reasons = runtimeCaptureCompatibility(families[0].capture, families[1].capture);
    if (request.leftFamily === request.rightFamily || families[0].capture.captureId === families[1].capture.captureId) result.reasons.push('distinct_captures_required');
    if (result.reasons.length) {
      result.status = 'incompatible';
      result.pinnedFamilies = [...new Map(pins.map(pin => [canonicalSemanticJson(pin), pin])).values()];
      return assertRuntimeClaims('compareResult', result);
    }
    const maps = [], citations = []; let bytes = 0, visited = 0;
    for (let familyIndex = 0; familyIndex < 2; familyIndex++) {
      const family = families[familyIndex], groups = new Map();
      for (const source of request.sources) {
        if (!family.capture.sources.some(item => same(item, source))) { result.reasons.push('requested_source_absent'); continue; }
        const entries = family.db.prepare("SELECT * FROM evidence WHERE kind='cpuProfile' AND join_quality='exact-source' AND source_unit_id=? AND source_hash=? ORDER BY ordinal LIMIT ?")
          .all(source.sourceUnitId, source.byteHash, request.limits.maxRecords + 1);
        if (!entries.length) result.reasons.push('exact_cpu_source_mapping_unavailable');
        for (const entry of entries) {
          check(); if (++visited > request.limits.maxRecords) throw runtimeImportError('Comparison observation allowance exceeded; no partial sum is published.', 'ERR_RUNTIME_QUERY_BUDGET');
          const row = await family.hydrate(entry, request.limits.maxBytes - bytes);
          if (!row) throw runtimeImportError('Comparison observation exceeds byte allowance.', 'ERR_RUNTIME_QUERY_BUDGET');
          bytes += entry.byte_length;
          if (row.data.lineNumber === null || row.data.columnNumber === null || !row.join.targets.length) { result.reasons.push('precise_source_location_unavailable'); continue; }
          const key = location(row), group = groups.get(key) || { rows: [], count: 0 };
          group.rows.push(row); group.count += row.data.sampleCount; groups.set(key, group);
          citations.push({ generationId: pins[familyIndex].generationId, captureId: row.captureId, evidenceId: row.evidenceId, rowHash: entry.row_hash });
        }
      }
      maps.push(groups);
    }
    for (const [key, left] of maps[0]) {
      const right = maps[1].get(key);
      if (!right) { result.reasons.push('matching_source_location_unavailable'); continue; }
      const observed = [...left.rows, ...right.rows], primary = left.rows[0];
      const data = { claim: 'Saved exact-source profile location has ' + left.count + ' attributed samples in ' + pins[0].captureId
        + ' and ' + right.count + ' in ' + pins[1].captureId + '.', scope: 'Two explicitly pinned saved capture windows; exact source location only.',
      assumptions: ['Sample counts describe these saved windows only; not call counts, rates, performance improvement or causality.',
        'Equal source coordinates do not assert equal code versions or runtime producer identity.',
        'No cross-capture timestamp alignment or duration equivalence is asserted.'],
      supportingEvidenceIds: observed.map(row => row.evidenceId), contradictingEvidenceIds: [],
      method: { id: 'saved-exact-source-sample-count-comparison', version: '1' }, confidence: 'high',
      confidenceBasis: ['Exact retained observations and raw hashes support the descriptive arithmetic only.'],
      alternatives: ['Sampling variation, different window lengths and unobserved executions can explain different counts.'],
      nextObservation: { question: 'Does another compatible saved capture report the same source-location sample pattern?',
        evidenceKinds: ['cpuProfile'], expectedInformationGain: 'Check repeatability without treating two windows as a causal experiment.',
        estimatedCost: 'Compare another existing saved profile; any new capture needs separate authorization.',
        permissionRequirements: ['Explicit authorization before execution, collection or attachment.'] } };
      const claim = { schemaVersion: 1, evidenceId: 'derived:' + semanticHash('pairofcleats.runtime.sample-claim.v1', { pins, key, data }),
        captureId: primary.captureId, projectionVersion: '1', kind: 'derivedClaim', evidenceClass: 'inferred',
        scope: primary.scope, clock: primary.clock, timestamp: null, workload: primary.workload, join: primary.join,
        rawRefs: [...new Map(observed.flatMap(row => row.rawRefs).map(ref => [canonicalSemanticJson(ref), ref])).values()],
        unavailable: ['causal-inference', 'cross-capture-time-alignment', 'code-version-equivalence'], warnings: [], data };
      result.claims.push(claim);
      if (result.claims.length > 64) throw runtimeImportError('Comparison claim allowance exceeded.', 'ERR_RUNTIME_QUERY_BUDGET');
    }
    if ([...maps[1].keys()].some(key => !maps[0].has(key))) result.reasons.push('matching_source_location_unavailable');
    result.reasons = [...new Set(result.reasons)];
    if (!result.claims.length) result.reasons.push('no_supported_comparison');
    if (result.reasons.length) result.status = 'partial';
    if (Buffer.byteLength(JSON.stringify(result)) > request.limits.maxBytes) throw runtimeImportError('Comparison result exceeds byte allowance.', 'ERR_RUNTIME_QUERY_BUDGET');
    check();
    if (request.persist && result.claims.length) result.claimGeneration = await persistRuntimeDerivedClaims({ destination,
      repositoryNamespace: request.repositoryNamespace, generation: request.generation, inputs: pins, citations,
      claims: result.claims, limits: request.limits, signal });
    check(); return assertRuntimeClaims('compareResult', result);
  } catch (error) { check(); throw error; }
  finally { for (const family of families) await family.close(); }
};
