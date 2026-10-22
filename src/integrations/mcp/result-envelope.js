/** Normalize both supported MCP overload envelopes without replaying requests. */
export const normalizeMcpToolResponse = response => {
  if (response?.error && typeof response.error.code === 'number') {
    const error = response.error;
    const code = error.data?.code || 'INTERNAL';
    return { ok: false, kind: 'protocol-error', code, message: error.message || 'MCP protocol error.',
      protocolCode: error.code, details: error.data || null, retryable: code === 'QUEUE_OVERLOADED' };
  }
  const result = response?.result ?? response;
  if (result?.isError === true) {
    const text = (Array.isArray(result.content) ? result.content : [])
      .filter(item => item?.type === 'text').map(item => String(item.text || '')).join('\n');
    let details = result.structuredContent || null;
    if (!details) { try { details = JSON.parse(text); } catch {} }
    const code = typeof details?.code === 'string' ? details.code : 'INTERNAL';
    return { ok: false, kind: 'tool-error', code,
      message: details?.message || text || 'MCP tool error.', details, retryable: code === 'QUEUE_OVERLOADED' };
  }
  return { ok: true, kind: 'success', result };
};
