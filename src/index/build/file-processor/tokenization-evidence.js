const ROUTES = new Set(['worker-pool', 'process-pool', 'inline', 'pretokenized', 'disabled']);
const REASONS = new Set(['size', 'mode', 'disabled-config', 'heap-contract', 'caller-error', 'pool-unavailable', 'cached', 'eligible']);
export const createTokenizationEvidence = () => ({ processedChunks: 0, routes: {}, reasons: {}, firstInlineReason: null });
export const recordTokenizationRoute = (evidence, route, reason) => {
  if (!evidence || !ROUTES.has(route)) return;
  const boundedReason = REASONS.has(reason) ? reason : 'pool-unavailable';
  evidence.processedChunks += 1;
  evidence.routes[route] = (evidence.routes[route] || 0) + 1;
  evidence.reasons[boundedReason] = (evidence.reasons[boundedReason] || 0) + 1;
  if ((route === 'inline' || route === 'disabled') && !evidence.firstInlineReason) evidence.firstInlineReason = boundedReason;
};
export const observedTokenizationExecution = evidence => {
  const used = Object.entries(evidence?.routes || {}).filter(([, count]) => count > 0).map(([route]) => route);
  return !used.length ? 'not-yet-observed' : used.length === 1 ? used[0] : 'mixed';
};
