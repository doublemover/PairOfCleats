import { sha1 } from '../../shared/hash.js';
import { stableStringify } from '../../shared/stable-json.js';

export const normalizeProviderId = (value) => String(value || '').trim().toLowerCase();

export const hashProviderConfig = (config) => {
  const normalized = config && typeof config === 'object' ? config : {};
  return sha1(stableStringify(normalized));
};

export const buildDuplicateChunkUidChecks = (targets, options = {}) => {
  const seen = new Set();
  const dupes = new Set();
  const label = typeof options.label === 'string' && options.label.trim()
    ? options.label.trim()
    : 'tooling';
  const maxSamples = Number.isFinite(Number(options.maxSamples))
    ? Math.max(0, Math.floor(Number(options.maxSamples)))
    : 3;
  for (const target of Array.isArray(targets) ? targets : []) {
    const chunkRef = target?.chunkRef || target?.chunk || null;
    const chunkUid = chunkRef?.chunkUid || target?.chunkUid || null;
    if (!chunkUid) continue;
    if (seen.has(chunkUid)) {
      dupes.add(chunkUid);
      continue;
    }
    seen.add(chunkUid);
  }
  if (!dupes.size) return [];
  const samples = Array.from(dupes).slice(0, maxSamples);
  const suffix = samples.length ? `: ${samples.join(', ')}` : '';
  return [{
    name: 'duplicate_chunk_uid',
    status: 'warn',
    message: `${label} provider received ${dupes.size} duplicate chunkUid target(s)${suffix}`,
    count: dupes.size,
    samples
  }];
};

export const appendDiagnosticChecks = (diagnostics, checks) => {
  if (!Array.isArray(checks) || !checks.length) return diagnostics || null;
  const next = diagnostics && typeof diagnostics === 'object' ? { ...diagnostics } : {};
  const existing = Array.isArray(next.checks) ? next.checks : [];
  next.checks = [...existing, ...checks];
  return next;
};

export const validateToolingProvider = (provider) => {
  if (!provider || typeof provider !== 'object') return 'provider missing';
  if (!normalizeProviderId(provider.id)) return 'provider.id missing';
  if (!provider.version) return 'provider.version missing';
  if (!provider.capabilities || typeof provider.capabilities !== 'object') return 'provider.capabilities missing';
  if (provider.languages && !Array.isArray(provider.languages)) return 'provider.languages must be array';
  if (provider.kinds && !Array.isArray(provider.kinds)) return 'provider.kinds must be array';
  if (typeof provider.getConfigHash !== 'function') return 'provider.getConfigHash missing';
  if (typeof provider.run !== 'function') return 'provider.run missing';
  return null;
};
