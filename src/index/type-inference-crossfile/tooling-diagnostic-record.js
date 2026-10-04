const OMIT_KEYS = new Set(['env', 'environment', 'byChunkUid', 'diagnosticsByChunkUid']);
const SECRET_KEY = /^(?:password|passwd|token|access[_-]?token|authorization|api[_-]?key|client[_-]?secret|credentials?)$/iu;

/** Bounded diagnostic excerpts; raw process output and complete source data remain outside this record. */
export const redactToolingDiagnosticText = (value, maxChars = 768) => {
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

/** Project only bounded diagnostic metadata, preserving cause names and source/lifetime labels. */
export const buildToolingDiagnosticRecord = ({ providerId, providerContractVersion = null, diagnostics,
  maxChars = 16 * 1024, maxChecks = 32 } = {}) => {
  const limit = Number.isFinite(maxChars) ? Math.max(512, Math.floor(maxChars)) : 16 * 1024;
  const checkLimit = Number.isFinite(maxChecks) ? Math.max(0, Math.min(32, Math.floor(maxChecks))) : 32;
  let remainingNodes = 192;
  let truncated = false;
  const seen = new WeakSet();
  const project = (value, depth = 0, key = '') => {
    if (SECRET_KEY.test(key)) return '[redacted]';
    if (remainingNodes-- <= 0 || depth > 4) { truncated = true; return '[bounded]'; }
    if (value == null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : '[non-finite]';
    if (typeof value === 'string') {
      if (value.length > 768) truncated = true;
      return redactToolingDiagnosticText(value);
    }
    if (typeof value !== 'object') return redactToolingDiagnosticText(value);
    if (seen.has(value)) { truncated = true; return '[circular]'; }
    seen.add(value);
    if (Array.isArray(value)) {
      const result = [];
      for (let index = 0; index < Math.min(value.length, 16); index += 1) {
        result.push(project(value[index], depth + 1));
      }
      if (value.length > 16) truncated = true;
      seen.delete(value);
      return result;
    }
    const result = Object.create(null);
    let count = 0;
    for (const field in value) {
      if (!Object.hasOwn(value, field) || OMIT_KEYS.has(field)) continue;
      if (count++ >= 24 || remainingNodes <= 0) { truncated = true; break; }
      // Arguments can contain credentials as separate tokens; command/version/probe metadata still remains.
      if (field === 'args' || field === 'arguments') { truncated = true; continue; }
      result[redactToolingDiagnosticText(field, 96)] = project(value[field], depth + 1, field);
    }
    seen.delete(value);
    return result;
  };
  const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
  const selectedChecks = [];
  const inspectedCheckCount = Math.min(checks.length, 256);
  const orderedIndices = [];
  for (const warnings of [true, false]) {
    for (let index = 0; index < inspectedCheckCount && orderedIndices.length < checkLimit; index += 1) {
      if (['warn', 'error'].includes(checks[index]?.status) === warnings) orderedIndices.push(index);
    }
  }
  for (const index of orderedIndices) {
    const check = checks[index];
    if (String(check?.message || '').length > 768) truncated = true;
    selectedChecks.push({ name: redactToolingDiagnosticText(check?.name || 'unnamed', 96),
      status: redactToolingDiagnosticText(check?.status || 'unknown', 32),
      message: redactToolingDiagnosticText(check?.message),
      ...(check?.count != null ? { count: project(check.count) } : {}) });
  }
  if (checks.length > selectedChecks.length) truncated = true;
  const source = redactToolingDiagnosticText(diagnostics?.diagnosticsSource || 'unknown', 48);
  const cachedSource = source === 'cache' || source === 'cache-suppressed';
  const record = {
    schemaVersion: 1,
    providerId: redactToolingDiagnosticText(providerId || 'unknown', 96),
    providerContractVersion: redactToolingDiagnosticText(providerContractVersion, 48) || null,
    diagnosticsSource: source,
    reportedCheckCount: checks.length,
    inspectedCheckCount,
    checks: selectedChecks,
    preflight: project(diagnostics?.preflight || null),
    fidelity: project(diagnostics?.fidelity || null),
    runtime: cachedSource ? null : project(diagnostics?.runtime || null),
    cachedRuntimeOmitted: cachedSource,
    truncated
  };
  // Drop lower-priority runtime/fidelity detail before shortening the retained initiating checks.
  while (JSON.stringify(record).length > limit) {
    record.truncated = true;
    if (record.runtime) record.runtime = null;
    else if (record.fidelity) record.fidelity = null;
    else if (record.preflight) record.preflight = null;
    else if (record.checks.length > 1) record.checks.pop();
    else if (record.checks[0]?.message) record.checks[0].message = record.checks[0].message.slice(0, Math.max(0, record.checks[0].message.length - 128));
    else return { schemaVersion: 1, providerId: record.providerId.slice(0, 32), diagnosticsSource: source.slice(0, 16),
      reportedCheckCount: checks.length, inspectedCheckCount, checks: record.checks.map((check) => ({
        name: check.name.slice(0, 32), status: check.status.slice(0, 16), message: '' })), truncated: true };
  }
  return record;
};
