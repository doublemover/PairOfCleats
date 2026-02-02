import { SCM_PROVIDER_NAMES } from './types.js';

const REQUIRED_METHODS = [
  'detect',
  'listTrackedFiles',
  'getRepoProvenance',
  'getChangedFiles',
  'getFileMeta'
];

const OPTIONAL_METHODS = ['annotate'];

export const normalizeProviderName = (value) => {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SCM_PROVIDER_NAMES.includes(name) ? name : null;
};

export const assertScmProvider = (provider) => {
  if (!provider || typeof provider !== 'object') {
    throw new Error('SCM provider must be an object.');
  }
  const name = normalizeProviderName(provider.name);
  if (!name) {
    throw new Error('SCM provider name is missing or invalid.');
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof provider[method] !== 'function') {
      throw new Error(`SCM provider ${name} missing ${method}().`);
    }
  }
  for (const method of OPTIONAL_METHODS) {
    if (provider[method] != null && typeof provider[method] !== 'function') {
      throw new Error(`SCM provider ${name} ${method} must be a function.`);
    }
  }
  return { ...provider, name };
};
