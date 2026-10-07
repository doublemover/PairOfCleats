/** Bounded diagnostic excerpts; raw process output and complete source data remain outside this record. */
export const redactDiagnosticText = (value, maxChars = 768) => {
  let text = String(value ?? '').slice(0, maxChars + 1)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, ' ')
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/giu, '$1 [redacted]')
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+(?:@|$)/giu, '$1[redacted]@')
    .replace(/([?&](?:token|access_token|api_key|password)=)[^&#\s]+/giu, '$1[redacted]')
    .replace(/\b((?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*)[^\s,;]+/giu, '$1[redacted]');
  if (text.length > maxChars) text = text.slice(0, maxChars);
  if (/[\ud800-\udbff]$/u.test(text)) text = text.slice(0, -1);
  return text;
};

