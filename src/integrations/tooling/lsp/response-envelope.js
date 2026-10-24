/** Classify the parsed wire envelope without copying provider payloads. The
 * fixed reasons are diagnostic categories, never reflected remote strings.
 */
export const classifyLspEnvelope = message => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return { reason: 'object-required' };
  if (message.jsonrpc !== '2.0') return { reason: 'version' };
  const hasId = Object.hasOwn(message, 'id'), hasMethod = Object.hasOwn(message, 'method');
  const hasResult = Object.hasOwn(message, 'result'), hasError = Object.hasOwn(message, 'error');
  if (hasMethod) {
    if (typeof message.method !== 'string' || !message.method || hasResult || hasError) return { reason: 'method-shape' };
    if (hasId && !validId(message.id)) return { reason: 'id-shape' };
    return { kind: hasId ? 'request' : 'notification' };
  }
  if (!hasId || !validId(message.id)) return { reason: 'id-shape' };
  if (hasResult === hasError) return { reason: 'result-error-exclusive' };
  if (hasError) {
    const error = message.error;
    if (!error || typeof error !== 'object' || Array.isArray(error)
      || !Number.isInteger(error.code) || typeof error.message !== 'string') return { reason: 'error-shape' };
  }
  return { kind: 'response' };
};

const validId = id => id === null || typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
