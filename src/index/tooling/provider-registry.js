import { normalizeProviderId, validateToolingProvider } from './provider-contract.js';
import { createConfiguredLspProviders } from './lsp-provider.js';

export const TOOLING_PROVIDERS = new Map();

const normalizeList = (value) => {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
};

const normalizeLowerList = (value) => normalizeList(value).map((entry) => entry.toLowerCase());

const normalizeLanguageId = (value) => String(value || '').trim().toLowerCase();

const resolveProviderPriority = (provider) => {
  const raw = Number(provider?.priority);
  return Number.isFinite(raw) ? raw : 100;
};

const compareProviders = (a, b) => {
  const priorityA = resolveProviderPriority(a);
  const priorityB = resolveProviderPriority(b);
  if (priorityA !== priorityB) return priorityA - priorityB;
  const idA = normalizeProviderId(a?.id);
  const idB = normalizeProviderId(b?.id);
  return idA.localeCompare(idB);
};

const normalizeProviderSet = (value) => new Set(normalizeLowerList(value));

const normalizeLanguageSet = (value) => new Set(normalizeLowerList(value));

const normalizeKindSet = (value) => new Set(normalizeLowerList(value));

export function registerToolingProvider(provider) {
  const id = normalizeProviderId(provider?.id);
  if (!id) throw new Error('Tooling provider id missing.');
  const err = validateToolingProvider(provider);
  if (err) throw new Error(`Tooling provider ${id} invalid: ${err}`);
  TOOLING_PROVIDERS.set(id, provider);
  return provider;
}

export function getToolingProvider(id) {
  const key = normalizeProviderId(id);
  return TOOLING_PROVIDERS.get(key) || null;
}

export function listToolingProviders(toolingConfig = null) {
  const providers = Array.from(TOOLING_PROVIDERS.values());
  if (toolingConfig) {
    providers.push(...createConfiguredLspProviders(toolingConfig));
  }
  return providers;
}

export function selectToolingProviders({
  toolingConfig = null,
  documents = [],
  targets = [],
  providerIds = null,
  kinds = null
} = {}) {
  const docs = Array.isArray(documents) ? documents : [];
  const targetList = Array.isArray(targets) ? targets : [];
  const providers = listToolingProviders(toolingConfig);
  const enabledTools = normalizeProviderSet(toolingConfig?.enabledTools || []);
  const disabledTools = normalizeProviderSet(toolingConfig?.disabledTools || []);
  const kindFilter = normalizeKindSet(kinds || []);

  const providerById = new Map();
  for (const provider of providers) {
    const id = normalizeProviderId(provider?.id);
    if (!id || providerById.has(id)) continue;
    providerById.set(id, provider);
  }

  const ordered = [];
  const used = new Set();
  if (Array.isArray(providerIds) && providerIds.length) {
    for (const rawId of providerIds) {
      const id = normalizeProviderId(rawId);
      const provider = providerById.get(id);
      if (!provider || used.has(id)) continue;
      ordered.push(provider);
      used.add(id);
    }
  } else {
    const orderOverride = normalizeLowerList(toolingConfig?.providerOrder || []);
    if (orderOverride.length) {
      for (const rawId of orderOverride) {
        const id = normalizeProviderId(rawId);
        const provider = providerById.get(id);
        if (!provider || used.has(id)) continue;
        ordered.push(provider);
        used.add(id);
      }
    }
    const remaining = providers.filter((provider) => {
      const id = normalizeProviderId(provider?.id);
      return id && !used.has(id);
    });
    remaining.sort(compareProviders);
    for (const provider of remaining) ordered.push(provider);
  }

  const plans = [];
  for (const provider of ordered) {
    const id = normalizeProviderId(provider?.id);
    if (!id) continue;
    if (disabledTools.has(id)) continue;
    if (enabledTools.size && !enabledTools.has(id)) continue;
    if (provider.enabled === false) continue;

    const providerKinds = normalizeKindSet(provider.kinds || []);
    if (kindFilter.size) {
      if (!providerKinds.size) continue;
      let matches = false;
      for (const kind of kindFilter) {
        if (providerKinds.has(kind)) {
          matches = true;
          break;
        }
      }
      if (!matches) continue;
    }

    const languageSet = normalizeLanguageSet(provider.languages || []);
    const filteredDocs = languageSet.size
      ? docs.filter((doc) => languageSet.has(normalizeLanguageId(doc?.languageId)))
      : docs;
    const filteredTargets = languageSet.size
      ? targetList.filter((target) => languageSet.has(normalizeLanguageId(target?.languageId)))
      : targetList;
    if (!filteredDocs.length && !filteredTargets.length) continue;
    plans.push({ provider, documents: filteredDocs, targets: filteredTargets });
  }

  return plans;
}
