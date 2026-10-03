function apiOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch { return null; }
}

function buildDestinationBoundApiHeaders(config, destination, { endpointKey, envKey, processEnv = process.env }) {
  // Missing inspect/provenance is not a trusted global setting.
  const endpoint = config?.inspect?.(endpointKey)?.globalValue;
  const approvedOrigin = apiOrigin(endpoint);
  if (!approvedOrigin || approvedOrigin !== apiOrigin(destination)) return {};
  const userEnv = config?.inspect?.(envKey)?.globalValue;
  const token = String(userEnv?.PAIROFCLEATS_API_TOKEN || processEnv.PAIROFCLEATS_API_TOKEN || '').trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function workspaceTrustError() {
  const error = new Error('PairOfCleats execution requires a trusted VS Code workspace.');
  error.code = 'UNTRUSTED_WORKSPACE';
  return error;
}

module.exports = { apiOrigin, buildDestinationBoundApiHeaders, workspaceTrustError };
