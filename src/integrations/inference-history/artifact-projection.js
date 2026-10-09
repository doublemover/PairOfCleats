import { sanitizeEmbeddedAssetText, sanitizeEmbeddedAssetValue, sanitizeNamedAssetPayload } from './embedded-assets.js';
import { digest, redactHistoryText } from './common.js';
export const ARTIFACT_PROJECTION_VERSION = 'artifact-projection.v3';
export function hasHiddenTraceMarker(text) {
  return /<(?:analysis|thinking|reasoning)>|["']channel["']\s*:\s*["']analysis["']|\b(?:chain_of_thought|scratchpad|hidden_reasoning)\b/i.test(text);
}
const blocked = /^(?:analysis|reasoning|thinking|scratchpad|chain_of_thought|raw|raw_json|diagnostics|mapping|turns|input_items|output_items|prompt|system_prompt|password|token|access_token|api_key|client_secret|secret|activity_messages|messages)$/i;
export function sanitizeArtifactJson(value, depth = 0, options = {}) {
  if (depth > 64) return '[depth omitted]';
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string') return hasHiddenTraceMarker(value) ? '[trace omitted]' : sanitizeEmbeddedAssetValue(redactHistoryText(value), options.audit);
    return value;
  }
  if (value.channel === 'analysis' || value.visibility === 'hidden') return '[hidden item omitted]';
  if (Array.isArray(value)) {
    if (value.length > 1000 || value.every(item => typeof item === 'number')) return { omitted_array_items: value.length };
    return value.map(item => sanitizeArtifactJson(item, depth + 1, options));
  }
  return Object.fromEntries(Object.entries(value).filter(([key]) => !blocked.test(key))
    .map(([key, item]) => [key, sanitizeNamedAssetPayload(key, item, options.audit) ?? sanitizeArtifactJson(item, depth + 1, options)]));
}
export function projectArtifact({ text, sourceSha256, locator, kind = 'document', createdAt = null, dateBasis = 'unknown', chunkChars = 4000, audit, originalTextChars = text?.length, sourceTransformed = false }) {
  if (typeof text !== 'string' || !/^[a-f0-9]{64}$/.test(sourceSha256)
    || !Number.isSafeInteger(chunkChars) || chunkChars < 256 || chunkChars > 8000
    || !Number.isSafeInteger(originalTextChars) || originalTextChars < 0 || typeof sourceTransformed !== 'boolean') throw new Error('Invalid artifact projection.');
  if (hasHiddenTraceMarker(text)) return [];
  const sanitized = sanitizeEmbeddedAssetText(redactHistoryText(text), audit).replace(/(["'](?:password|token|api_key|access_token|secret|client_secret)["']\s*:\s*)["'][^"'\r\n]*["']/gi, '$1"[REDACTED credential]"');
  // Mapping is deliberately coarse over changed redacted content, never a raw byte offset.
  const transformation = { original_start: 0, original_end: originalTextChars, sanitized_start: 0,
    sanitized_end: sanitized.length, kind: !sourceTransformed && originalTextChars === text.length && text === sanitized ? 'identity' : 'redacted_coarse' };
  const safeLocator = redactHistoryText(String(locator ?? '')).slice(0, 1024);
  const result = [];
  for (let start = 0; start < sanitized.length;) {
    let end = Math.min(sanitized.length, start + chunkChars);
    if (end < sanitized.length && /[\uD800-\uDBFF]/.test(sanitized[end - 1])) end--;
    const id = digest(JSON.stringify([sourceSha256, safeLocator, kind, start, end, ARTIFACT_PROJECTION_VERSION]));
    result.push({ id, title: safeLocator, body: sanitized.slice(start, end), visibility: 'visible', artifact_kind: kind,
      created_at: createdAt, provenance: { source_sha256: sourceSha256, locator: safeLocator, chunk_start: start,
        chunk_end: end, offset_basis: 'sanitized_utf16', projection_version: ARTIFACT_PROJECTION_VERSION, transformation, total_chars: sanitized.length, date_basis: dateBasis } });
    start = end;
  }
  return result;
}

