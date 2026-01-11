export const normalizeLimit = (value, fallback) => {
  if (value === 0 || value === false) return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return fallback;
};

export const pickMinLimit = (...values) => {
  const candidates = values.filter((value) => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.min(...candidates) : null;
};

export const normalizeDepth = (value, fallback) => {
  if (value === 0) return 0;
  if (value === false) return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return fallback;
};

export const normalizeRatio = (value, fallback) => {
  if (value === undefined || value === null || value === false) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
};

const normalizeCapValue = (value) => {
  if (value === 0 || value === false) return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return null;
};

export const normalizeCapEntry = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const maxBytes = normalizeCapValue(input.maxBytes);
  const maxLines = normalizeCapValue(input.maxLines);
  return { maxBytes, maxLines };
};

export const normalizeCapsByExt = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    const entry = normalizeCapEntry(value);
    if (entry.maxBytes == null && entry.maxLines == null) continue;
    const normalizedKey = key.startsWith('.') ? key.toLowerCase() : `.${key.toLowerCase()}`;
    output[normalizedKey] = entry;
  }
  return output;
};

export const normalizeCapsByLanguage = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    const entry = normalizeCapEntry(value);
    if (entry.maxBytes == null && entry.maxLines == null) continue;
    output[key.toLowerCase()] = entry;
  }
  return output;
};

export const normalizeOptionalLimit = (value) => {
  if (value === 0 || value === false) return null;
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};

export const normalizeTreeSitterByLanguage = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    const entry = value && typeof value === 'object' ? value : {};
    const maxBytes = normalizeCapValue(entry.maxBytes);
    const maxLines = normalizeCapValue(entry.maxLines);
    const maxParseMs = normalizeOptionalLimit(entry.maxParseMs);
    if (maxBytes == null && maxLines == null && maxParseMs == null) continue;
    output[key.toLowerCase()] = { maxBytes, maxLines, maxParseMs };
  }
  return output;
};

export const resolveFileCapsAndGuardrails = (indexingConfig) => {
  const maxFileBytes = normalizeLimit(indexingConfig.maxFileBytes, 5 * 1024 * 1024);
  const fileCapsConfig = indexingConfig.fileCaps || {};
  const fileCaps = {
    default: normalizeCapEntry(fileCapsConfig.default || {}),
    byExt: normalizeCapsByExt(fileCapsConfig.byExt || {}),
    byLanguage: normalizeCapsByLanguage(fileCapsConfig.byLanguage || {})
  };
  const untrustedConfig = indexingConfig.untrusted || {};
  const untrustedEnabled = untrustedConfig.enabled === true;
  const untrustedDefaults = {
    maxFileBytes: 1024 * 1024,
    maxLines: 10000,
    maxFiles: 100000,
    maxDepth: 25
  };
  const untrustedMaxFileBytes = normalizeLimit(untrustedConfig.maxFileBytes, untrustedDefaults.maxFileBytes);
  const untrustedMaxLines = normalizeLimit(untrustedConfig.maxLines, untrustedDefaults.maxLines);
  const untrustedMaxFiles = normalizeLimit(untrustedConfig.maxFiles, untrustedDefaults.maxFiles);
  const untrustedMaxDepth = normalizeDepth(untrustedConfig.maxDepth, untrustedDefaults.maxDepth);
  let guardrails = {
    enabled: false,
    maxFiles: null,
    maxDepth: null,
    maxFileBytes: null,
    maxLines: null
  };
  let resolvedMaxFileBytes = maxFileBytes;
  if (untrustedEnabled) {
    guardrails = {
      enabled: true,
      maxFiles: untrustedMaxFiles,
      maxDepth: untrustedMaxDepth,
      maxFileBytes: untrustedMaxFileBytes,
      maxLines: untrustedMaxLines
    };
    const nextMaxFileBytes = pickMinLimit(resolvedMaxFileBytes, untrustedMaxFileBytes);
    if (nextMaxFileBytes != null) {
      resolvedMaxFileBytes = nextMaxFileBytes;
    }
    if (untrustedMaxFileBytes) {
      fileCaps.default.maxBytes = pickMinLimit(fileCaps.default.maxBytes, untrustedMaxFileBytes);
    }
    if (untrustedMaxLines) {
      fileCaps.default.maxLines = pickMinLimit(fileCaps.default.maxLines, untrustedMaxLines);
    }
  }
  return { maxFileBytes: resolvedMaxFileBytes, fileCaps, guardrails };
};
