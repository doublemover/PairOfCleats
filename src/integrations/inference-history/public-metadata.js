import { redactHistoryText } from './common.js';

/** The same permitted identity projection for import and owner reprojection. */
export function projectHistoryPublicIdentity(node, evidenceKind, policy) {
  if (policy.redactions.length) {
    return { sourceDetails: evidenceKind === 'recovered_artifact'
      ? { projectionVersion: node.sourceDetails.projectionVersion } : {}, messageId: null };
  }
  const sourceDetails = Object.fromEntries(Object.entries(node.sourceDetails || {})
    .filter(([key, value]) => value === null || ['string', 'boolean'].includes(typeof value)
      || ['sanitizedStart', 'sanitizedEnd', 'totalChars'].includes(key) && Number.isSafeInteger(value) && value >= 0
      || key === 'transformation' && value && typeof value === 'object'
        && Object.keys(value).sort().join(',') === 'kind,original_end,original_start,sanitized_end,sanitized_start'
        && ['identity', 'redacted_coarse'].includes(value.kind)
        && ['original_start', 'original_end', 'sanitized_start', 'sanitized_end'].every(field => Number.isSafeInteger(value[field]) && value[field] >= 0))
    .map(([key, value]) => [key, typeof value === 'string' ? redactHistoryText(value).slice(0, 512) : value]));
  return { sourceDetails, messageId: redactHistoryText(node.messageId).slice(0, 512) };
}
