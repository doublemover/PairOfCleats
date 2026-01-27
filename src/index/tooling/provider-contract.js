import { sha1 } from '../../shared/hash.js';
import { stableStringify } from '../../shared/stable-json.js';

export const normalizeProviderId = (value) => String(value || '').trim().toLowerCase();

export const hashProviderConfig = (config) => {
  const normalized = config && typeof config === 'object' ? config : {};
  return sha1(stableStringify(normalized));
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
