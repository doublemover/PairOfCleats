const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalidResponse = (details, message) => ({ ok: false, kind: 'invalid-response',
  code: 'INTERNAL', message, details, retryable: false });

/** Classify a tool response in either supported envelope; never replay work.
 * @param {unknown} response
 * @returns {import('./result-envelope.js').McpToolOutcome}
 */
export const normalizeMcpToolResponse = response => {
  if (!isRecord(response)) return invalidResponse(response, 'MCP tool response must be an object.');
  if (Object.hasOwn(response, 'error') && Object.hasOwn(response, 'result'))
    return invalidResponse(response, 'MCP response has conflicting error and result envelopes.');
  if (Object.hasOwn(response, 'error')) {
    const error = response.error;
    if (!isRecord(error)) return invalidResponse(response, 'Malformed MCP protocol error.');
    const code = typeof error.data?.code === 'string' ? error.data.code : 'INTERNAL';
    return { ok: false, kind: 'protocol-error', code,
      message: typeof error.message === 'string' && error.message ? error.message : 'MCP protocol error.',
      protocolCode: Number.isSafeInteger(error.code) ? error.code : null,
      details: error.data ?? error, retryable: code === 'QUEUE_OVERLOADED' };
  }
  const result = Object.hasOwn(response, 'result') ? response.result : response;
  if (!isRecord(result) || (result.isError !== undefined && typeof result.isError !== 'boolean')
    || (result.content !== undefined && !Array.isArray(result.content)))
    return invalidResponse(response, 'Malformed MCP tool-result envelope.');
  if (result.isError === true) {
    const text = (Array.isArray(result.content) ? result.content : [])
      .filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n');
    let details = isRecord(result.structuredContent) ? result.structuredContent : null;
    if (!details) { try { details = JSON.parse(text); } catch {} }
    const code = typeof details?.code === 'string' ? details.code : 'INTERNAL';
    return { ok: false, kind: 'tool-error', code,
      message: typeof details?.message === 'string' && details.message ? details.message : text || 'MCP tool error.',
      details, retryable: code === 'QUEUE_OVERLOADED' };
  }
  if (!Array.isArray(result.content) && !isRecord(result.structuredContent))
    return invalidResponse(response, 'MCP response does not contain a tool result.');
  return { ok: true, kind: 'success', result };
};
