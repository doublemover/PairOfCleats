import path from 'node:path';
import { TRIAGE_EVIDENCE_VERSION, TRIAGE_EVIDENCE_PREVIEW_LIMIT } from '../../src/contracts/triage-evidence.js';
import { isRetrievalExecution } from '../../src/contracts/retrieval-execution.js';
import { captureRetrievalScoreSpace } from '../../src/retrieval/score-observation.js';
import { RETRIEVAL_COHORT_FIELDS, selectRetrievalCohort } from '../shared/retrieval-cohort-admission.js';

const text = value => typeof value === 'string' && value.length > 0 ? value : null;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const boolean = value => typeof value === 'boolean' ? value : null;
const fields = (value, keys, admit = text) => Object.fromEntries(keys.map(key => [key, admit(value?.[key])]));
const range = (start, end, minimum) => Number.isSafeInteger(start) && start >= minimum
  && Number.isSafeInteger(end) && end >= start ? { status: 'known', start, end } : { status: 'unknown', start: null, end: null };

const captureReceipt = (payload, mode) => {
  const receipt = payload?.retrieval;
  const freshness = receipt?.freshness?.byMode?.[RETRIEVAL_COHORT_FIELDS[mode]];
  const execution = receipt?.fidelity?.byMode?.[mode];
  return {
    ...fields(receipt, ['effectiveSystemIdentity', 'scorePolicyIdentity', 'effectivePlanIdentity']),
    backend: {
      ...fields(receipt?.backend, ['selected', 'requested', 'defaultBackend', 'selectionKind', 'selectionReason']),
      ...fields(receipt?.backend, ['forced', 'availabilityDriven'], boolean),
      legacyLabel: text(payload?.backend)
    },
    fidelity: {
      status: text(receipt?.fidelity?.status),
      fallbackDerived: boolean(receipt?.fidelity?.fallbackDerived),
      execution: isRetrievalExecution(execution, mode) ? JSON.parse(JSON.stringify(execution)) : null
    },
    freshness: {
      mode: freshness ? { ...fields(freshness, ['buildId', 'generationKey', 'activeBuildRoot', 'profileId', 'signature']),
        artifactSurfaceVersion: text(freshness.artifactSurfaceVersion) } : null,
      activeGeneration: receipt?.freshness?.activeGeneration
        ? fields(receipt.freshness.activeGeneration, ['buildId', 'activeBuildRoot', 'buildGenerationKey']) : null,
      asOf: receipt?.freshness?.asOf ? fields(receipt.freshness.asOf, ['ref', 'type', 'identityHash']) : null
    },
    cache: { hit: boolean(receipt?.cache?.hit), strategy: text(receipt?.cache?.strategy),
      memoryHotPath: boolean(receipt?.cache?.memoryHotPath) }
  };
};

/** A preview is display text, never a substitute for the indexed source. No
 * current same-path file is read, hashed or certified by this projection. */
export const projectTriageEvidenceHit = hit => {
  const preview = [hit.headline, ...(Array.isArray(hit.preContext) ? hit.preContext : []),
    ...(Array.isArray(hit.postContext) ? hit.postContext : [])]
    .filter(value => typeof value === 'string').join(' ').replace(/\s+/gu, ' ').trim();
  const snippet = preview.length > TRIAGE_EVIDENCE_PREVIEW_LIMIT
    ? `${preview.slice(0, TRIAGE_EVIDENCE_PREVIEW_LIMIT - 3)}...` : preview;
  return {
    file: text(hit.file), kind: text(hit.kind), name: text(hit.name),
    headline: text(hit.headline)?.slice(0, TRIAGE_EVIDENCE_PREVIEW_LIMIT) ?? null,
    score: number(hit.score), scoreType: text(hit.scoreType), scoreBreakdown: hit.scoreBreakdown || null,
    scoreSpace: captureRetrievalScoreSpace(hit.scoreSpace),
    source: {
      chunkUid: text(hit.chunkUid) || text(hit.metaV2?.chunkUid),
      ...fields(hit, ['segmentUid', 'repoId', 'globalId', 'buildId', 'generationKey', 'sourceHash']),
      fileHash: text(hit.fileHash) || text(hit.metaV2?.fileHash),
      fileHashAlgo: text(hit.fileHashAlgo) || text(hit.metaV2?.fileHashAlgo),
      lines: range(hit.startLine, hit.endLine, 1),
      offsets: { ...range(hit.start, hit.end, 0), unit: 'producer-offset' },
      navigation: { status: 'unavailable', reason: 'source-not-revalidated' }
    },
    snippet,
    preview: { lossy: true, exactSourceSupport: false, truncated: preview.length > TRIAGE_EVIDENCE_PREVIEW_LIMIT }
  };
};

/** Reuse the canonical selected-mode admission. Missing/malformed output is an
 * unavailable query, while an explicitly empty selected cohort is a real zero. */
export const projectTriageEvidence = ({ repoRoot, query, mode, result, limit }) => {
  const row = {
    schemaVersion: TRIAGE_EVIDENCE_VERSION, query, mode,
    repository: { root: path.resolve(repoRoot), identityKind: 'search-root-path' },
    status: 'unavailable', diagnostic: null,
    retrieval: captureReceipt(result?.payload, mode), hits: []
  };
  if (result?.ok !== true) {
    row.diagnostic = { code: text(result?.code) || 'ERR_TRIAGE_EVIDENCE_SEARCH',
      message: text(result?.error) || 'Search unavailable.' };
    return row;
  }
  let hits;
  try {
    hits = selectRetrievalCohort(result.payload, mode, { context: 'triage evidence',
      invalid: message => Object.assign(new Error(message), { code: 'ERR_TRIAGE_EVIDENCE_RESPONSE' }) });
  } catch (error) {
    if (error?.code !== 'ERR_TRIAGE_EVIDENCE_RESPONSE') throw error;
    row.diagnostic = { code: error.code, message: error.message };
    return row;
  }
  row.status = hits.length ? 'success' : 'empty';
  const cap = Number.isSafeInteger(limit) && limit >= 0 ? limit : hits.length;
  row.hits = hits.slice(0, cap).map(projectTriageEvidenceHit);
  row.retained = { available: hits.length, returned: row.hits.length, omitted: hits.length - row.hits.length };
  return row;
};
