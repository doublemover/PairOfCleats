export const CONTEXT_PACK_RESPONSE_MAX_BYTES = 128 * 1024;

/** Bound the complete JSON report, preserving primary evidence ahead of optional sections. */
export const enforceContextPackResponseBudget = (payload, { strictEvidence = false, strictRisk = false,
  measure = value => Buffer.byteLength(JSON.stringify(value, null, 2)) } = {}) => {
  const size = () => measure(payload);
  const before = size();
  if (before <= CONTEXT_PACK_RESPONSE_MAX_BYTES) return payload;
  const omitted = [];
  payload.warnings ||= [];
  const warning = { code: 'CONTEXT_PACK_RESPONSE_BUDGET',
    message: 'Optional sections omitted to fit the complete response byte budget.',
    maxBytes: CONTEXT_PACK_RESPONSE_MAX_BYTES, originalBytes: before, omitted };
  payload.warnings.push(warning);
  let currentBytes = size();
  // Keep local graph evidence longer than optional federation, risk and type detail.
  for (const section of ['semanticFederation', 'risk', 'semantic', 'types', 'graph', 'federation']) {
    if (currentBytes <= CONTEXT_PACK_RESPONSE_MAX_BYTES) break;
    if (payload[section] == null) continue;
    if ((strictRisk && section === 'risk') || (strictEvidence && section === 'types')) continue;
    if (section === 'semantic' || section === 'semanticFederation') delete payload[section];
    else payload[section] = null;
    omitted.push(section);
    if (section === 'semantic' && payload.evidence) {
      payload.evidence.complete = false;
      payload.evidence.semantic = { ...payload.evidence.semantic,
        included: false, state: 'omitted', truncated: true,
        warningCodes: [...new Set([...(payload.evidence.semantic?.warningCodes || []), warning.code])] };
    }
    if (section === 'types' && payload.evidence) {
      payload.evidence.complete = false;
      if (payload.evidence.types) payload.evidence.types = { ...payload.evidence.types,
        included: false, count: 0, state: 'omitted', truncated: true,
        warningCodes: [...(payload.evidence.types.warningCodes || []), warning.code] };
    }
    currentBytes = size();
  }
  if (currentBytes > CONTEXT_PACK_RESPONSE_MAX_BYTES) {
    throw Object.assign(new Error('Primary or required context evidence exceeds the complete response byte budget.'), {
      code: 'ERR_CONTEXT_PACK_RESPONSE_BUDGET'
    });
  }
  return payload;
};
