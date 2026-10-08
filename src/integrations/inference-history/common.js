import { createHash } from 'node:crypto';

export const ADAPTER_VERSION = 'chatgpt-export.v3';
export const PROJECTION_VERSION = 'history-text.v2';
export const historyError = (code, message) => Object.assign(new Error(message), { code });
export const digest = (value) => createHash('sha256').update(value).digest('hex');

export const DEFAULT_LIMITS = Object.freeze({
  maxArchiveBytes: 256 * 1024 * 1024,
  maxExpandedBytes: 512 * 1024 * 1024,
  maxMemberBytes: 128 * 1024 * 1024,
  maxConversationBytes: 8 * 1024 * 1024,
  maxEntries: 10000,
  maxConversations: 10000,
  maxNodes: 10000,
  maxUnits: 100000,
  maxTextChars: 32768,
  maxDepth: 128,
  maxMillis: 30000
});

export function resolveLimits(input = {}) {
  const limits = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(input)) {
    if (!(key in DEFAULT_LIMITS) || !Number.isSafeInteger(value) || value < 1) {
      throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'Invalid inference-history resource limit.');
    }
    limits[key] = value;
  }
  return Object.freeze(limits);
}

// These are deliberately high-confidence credential patterns, not an assertion
// that arbitrary private text is safe for publication. Redaction never grants access.
export function redactHistoryText(input) {
  return String(input ?? '')
    .replace(/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
      '[REDACTED private key]')
    .replace(/\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g,
      '[REDACTED credential]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, '$1[REDACTED credential]')
    .replace(/([?&](?:access_token|api_key|token|key|password|secret)=)[^\s&#)]+/gi, '$1[REDACTED credential]')
    .replace(/\b((?:password|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*)["']?[^\s"',;]+["']?/gi,
      '$1[REDACTED credential]');
}

/** Derive bounded query text while retaining deterministic source/trimming provenance. */
export function projectHistoryText(sourceText, maxTextChars) {
  if (typeof sourceText !== 'string' || !Number.isSafeInteger(maxTextChars) || maxTextChars < 0) {
    throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Invalid history projection input.');
  }
  const redacted = redactHistoryText(sourceText);
  let text = redacted.slice(0, maxTextChars);
  if (text.length < redacted.length && /[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  const truncated = text.length < redacted.length;
  return {
    text,
    metadata: {
      trimPolicyVersion: PROJECTION_VERSION,
      sourceTextHash: digest(sourceText),
      sourceTextChars: sourceText.length,
      redactedTextChars: redacted.length,
      projectedTextChars: text.length,
      characterBudget: maxTextChars,
      units: 'utf16_code_units',
      truncated,
      trimmedRows: truncated ? 1 : 0,
      trimmedFields: truncated ? 1 : 0,
      trimReasonCounts: truncated ? { character_budget: 1 } : {}
    }
  };
}
