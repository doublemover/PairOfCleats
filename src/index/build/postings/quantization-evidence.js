const ROUTES = new Set(['inline', 'worker-pool', 'process-pool', 'prequantized']);
const OUTCOMES = new Set(['completed', 'failed', 'cancelled']);
export const createQuantizationEvidence = () => ({ scope: 'dense-channel-execution', publication: 'separate-artifact-owner',
  rows: 0, routes: {}, attempts: {}, firstFallbackReason: null });
export const recordQuantization = (evidence, route, rows, outcome = 'completed', fallback = false) => {
  if (!evidence || !ROUTES.has(route) || !OUTCOMES.has(outcome)
    || !Number.isSafeInteger(rows) || rows < 1) return;
  const key = `${route}:${outcome}`;
  evidence.attempts[key] = (evidence.attempts[key] || 0) + rows;
  if (outcome === 'completed') {
    evidence.rows += rows;
    evidence.routes[route] = (evidence.routes[route] || 0) + rows;
  }
  if (fallback && !evidence.firstFallbackReason) evidence.firstFallbackReason = 'worker-unavailable';
};
export const observedQuantizationExecution = evidence => {
  const routes = [...ROUTES].filter(route => evidence?.routes?.[route] > 0);
  return routes.length === 0 ? 'not-yet-observed' : routes.length === 1 ? routes[0] : 'mixed';
};
