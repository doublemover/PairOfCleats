import { isRetrievalExecution } from '../../contracts/retrieval-execution.js';

const MODES = ['code', 'prose', 'extractedProse', 'records'];
const ACTIONS = new Map([['coverage-check', 'index-report'], ['backend-fallback', 'tooling-doctor'],
  ['no-indexed-metadata-match', 'tooling-doctor'], ['retrieval-provider-fallback', 'tooling-doctor']]);

/** Presentation of recorded retrieval facts. This never diagnoses staleness,
 * reconstructs omitted reasons, or authorizes a response-provided command. */
export const buildSearchDiagnostics = (retrieval) => {
  let truncated = false;
  const text = (value, limit = 256) => {
    if (typeof value !== 'string' || !value) return null;
    const safe = value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ');
    if (safe.length > limit) truncated = true;
    return safe.slice(0, limit);
  };
  const recorded = Boolean(retrieval && typeof retrieval === 'object');
  const backend = {
    requested: text(retrieval?.backend?.requested, 128),
    selected: text(retrieval?.backend?.selected, 128),
    selectionReason: text(retrieval?.backend?.selectionReason, 256),
    fidelity: ['complete', 'fallback-derived'].includes(retrieval?.fidelity?.status)
      ? retrieval.fidelity.status : 'unknown'
  };
  const executionReasons = ['code', 'prose', 'extracted-prose', 'records'].flatMap(mode => {
    const outcome = retrieval?.fidelity?.byMode?.[mode];
    return isRetrievalExecution(outcome, mode) && outcome.status === 'partial' ? [{ code: 'retrieval-provider-fallback',
      message: `Recorded ${mode} execution is partial: ${(outcome.reasons || []).slice(0, 8).join(', ')}.`,
      next: 'Retry after provider recovery; use tooling-doctor if it persists.' }] : [];
  });
  const inputReasons = [...executionReasons, ...(Array.isArray(retrieval?.emptyResults) ? retrieval.emptyResults : [])];
  if (inputReasons.length > 8) truncated = true;
  const reasons = inputReasons.slice(0, 8).map(reason => ({ code: text(reason?.code, 64),
    message: text(reason?.message, 512), next: text(reason?.next, 512) })).filter(reason => reason.code && reason.message);
  const generations = [];
  for (const mode of MODES) {
    const source = retrieval?.freshness?.byMode?.[mode];
    if (!source || typeof source !== 'object') continue;
    generations.push({ mode, buildId: text(source.buildId), generationKey: text(source.generationKey),
      signature: text(source.signature), profileId: text(source.profileId),
      artifactSurfaceVersion: text(typeof source.artifactSurfaceVersion === 'number' && Number.isFinite(source.artifactSurfaceVersion)
        ? String(source.artifactSurfaceVersion) : source.artifactSurfaceVersion) });
  }
  const summary = recorded
    ? `Backend: ${backend.selected || 'not recorded'}; fidelity: ${backend.fidelity}${backend.requested ? `; requested: ${backend.requested}` : ''}`
    : 'Search diagnostics were not recorded for this response.';
  const details = [summary, ...(backend.selectionReason ? [`Selection reason: ${backend.selectionReason}`] : []),
    'Recorded index identity does not verify the current worktree.'];
  for (const reason of reasons) {
    details.push(`${reason.code}: ${reason.message}`);
    if (reason.next) details.push(`Next: ${reason.next}`);
  }
  for (const generation of generations) details.push(`Recorded ${generation.mode} generation: ${generation.generationKey || generation.buildId || generation.signature || 'identity unavailable'}`);
  if (!generations.length) details.push('Per-mode generation identity was not recorded.');
  const actions = [...new Set(reasons.map(reason => ACTIONS.get(reason.code)).filter(Boolean))];
  return { schemaVersion: 1, state: recorded ? 'recorded' : 'unknown', summary, backend, reasons, generations,
    actions, details, truncated };
};
