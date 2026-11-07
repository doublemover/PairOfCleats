const cleanText = value => String(value).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, 4096);

function boundedFacts(value, byteLimit = 4096) {
  let remaining = byteLimit;
  let truncated = false;
  const visit = (input, depth = 0) => {
    if (remaining <= 0 || depth > 5) { truncated = true; return undefined; }
    if (input == null || typeof input === 'boolean' || (typeof input === 'number' && Number.isFinite(input))) {
      remaining -= 16;
      return input;
    }
    if (typeof input === 'string') {
      const text = cleanText(input);
      const output = text.slice(0, Math.min(512, Math.max(0, Math.floor(remaining / 4))));
      remaining -= Buffer.byteLength(JSON.stringify(output));
      if (output !== text) truncated = true;
      return output;
    }
    if (typeof input !== 'object') return undefined;
    const output = Array.isArray(input) ? [] : Object.create(null);
    const entries = Array.isArray(input) ? input.map((entry, index) => [index, entry]) : Object.entries(input);
    for (const [rawKey, entry] of entries.slice(0, 32)) {
      const key = cleanText(rawKey).slice(0, 128);
      remaining -= Buffer.byteLength(JSON.stringify(key)) + 2;
      const projected = visit(entry, depth + 1);
      if (projected !== undefined) output[key] = projected;
    }
    if (entries.length > 32) truncated = true;
    return output;
  };
  const facts = visit(value);
  if (Buffer.byteLength(JSON.stringify(facts ?? null)) > byteLimit) return { facts: null, truncated: true };
  return { facts, truncated };
}

function captureSearchExplanation(payload) {
  const stats = payload?.stats || {};
  const facts = {};
  for (const key of ['intent', 'routing', 'trust', 'contextExpansion', 'annCandidatePolicy', 'relationBoost', 'lexicon', 'index', 'provenance']) {
    if (stats[key] !== undefined) facts[key] = stats[key];
  }
  if (payload?.generation !== undefined) facts.generation = payload.generation;
  return { version: 1, source: 'captured-response', ...boundedFacts(facts, 8192) };
}

function renderSearchExplanation(resultSet, hit) {
  const lines = ['PairOfCleats ranking explanation', `Query: ${cleanText(resultSet.query)}`,
    `Repository: ${cleanText(resultSet.repoRoot)}`, `Captured: ${cleanText(resultSet.createdAt || 'unavailable')}`,
    `Hit: ${cleanText(hit.file)}:${hit.startLine || '?'}${hit.chunkUid ? ` (${cleanText(hit.chunkUid)})` : ''}`,
    `Total score: ${Number.isFinite(hit.score) ? hit.score : 'unavailable'}${hit.scoreType ? ` (${cleanText(hit.scoreType)})` : ''}`,
    '', 'Component evidence supplied by the search response:'];
  if (hit.scoreBreakdown && Object.keys(hit.scoreBreakdown).length) lines.push(JSON.stringify(hit.scoreBreakdown, null, 2));
  else lines.push('No component breakdown was supplied.');
  lines.push('', 'Captured query routing and trust facts:', JSON.stringify(resultSet.explanation?.facts || {}, null, 2));
  if (hit.explanationTruncated || resultSet.explanation?.truncated) lines.push('Explanation truncated by the editor display/history budget.');
  lines.push('This is captured response evidence; reopening does not run a new search or recompute scores.');
  return lines;
}

function normalizeCapturedExplanation(value) {
  if (value?.version !== 1 || value?.source !== 'captured-response') return null;
  const projected = boundedFacts(value.facts, 8192);
  return { version: 1, source: 'captured-response', ...projected, truncated: value.truncated === true || projected.truncated };
}

// Only the retrieval producer explains backend selection and empty results.
// This adapter bounds a recorded projection; old history remains unknown.
function normalizeSearchDiagnostics(value) {
  if (value?.schemaVersion !== 1) return {
    schemaVersion: 1, state: 'unknown', summary: 'Search diagnostics were not recorded for this response.',
    backend: { requested: null, selected: null, selectionReason: null, fidelity: 'unknown' },
    reasons: [], generations: [], actions: [], details: ['Search diagnostics were not recorded for this response.'], truncated: false
  };
  let truncated = value.truncated === true;
  const text = (input, limit = 256) => {
    if (typeof input !== 'string') return null;
    const safe = cleanText(input).replace(/[\r\n\t\u0080-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ');
    if (safe.length > limit || input.length > 4096) truncated = true;
    return safe.slice(0, limit);
  };
  const rows = (input, max, project) => {
    if (!Array.isArray(input)) return [];
    if (input.length > max) truncated = true;
    return input.slice(0, max).map(project);
  };
  const output = {
    schemaVersion: 1, state: value.state === 'recorded' ? 'recorded' : 'unknown', summary: text(value.summary, 768),
    backend: { requested: text(value.backend?.requested, 128), selected: text(value.backend?.selected, 128),
      selectionReason: text(value.backend?.selectionReason),
      fidelity: ['complete', 'fallback-derived'].includes(value.backend?.fidelity) ? value.backend.fidelity : 'unknown' },
    reasons: rows(value.reasons, 8, reason => ({ code: text(reason?.code, 64), message: text(reason?.message, 512), next: text(reason?.next, 512) })),
    generations: rows(value.generations, 4, generation => ({ mode: text(generation?.mode, 32),
      buildId: text(generation?.buildId), generationKey: text(generation?.generationKey), signature: text(generation?.signature),
      profileId: text(generation?.profileId), artifactSurfaceVersion: text(generation?.artifactSurfaceVersion) })),
    actions: rows(value.actions, 2, action => action).filter(action => ['index-report', 'tooling-doctor'].includes(action)),
    details: rows(value.details, 24, line => text(line, 768)).filter(Boolean)
  };
  return { ...output, truncated };
}

module.exports = { boundedFacts, captureSearchExplanation, renderSearchExplanation, normalizeCapturedExplanation, normalizeSearchDiagnostics };
