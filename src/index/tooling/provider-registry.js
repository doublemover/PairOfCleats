import { normalizeProviderId, validateToolingProvider } from './provider-contract.js';
import { createConfiguredLspProviders } from './lsp-provider.js';
import { admitProviderCatalog } from './provider-catalog.js';

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

const prepareProviderCatalog = toolingConfig => {
  const providers = [], origins = [];
  for (const [registeredId, provider] of TOOLING_PROVIDERS) {
    providers.push(provider);
    origins.push({ kind: 'registered', source: `registry:${registeredId}`, rawId: provider?.id });
  }
  if (toolingConfig) {
    const configured = createConfiguredLspProviders(toolingConfig);
    providers.push(...configured); origins.push(...configured.map(() => null));
  }
  return admitProviderCatalog(providers, origins);
};

export function listToolingProviders(toolingConfig = null) {
  return [...prepareProviderCatalog(toolingConfig).values()];
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
  const providerById = prepareProviderCatalog(toolingConfig);
  const enabledTools = normalizeProviderSet(toolingConfig?.enabledTools || []);
  const disabledTools = normalizeProviderSet(toolingConfig?.disabledTools || []);
  const kindFilter = normalizeKindSet(kinds || []);

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
    const remaining = [...providerById.values()].filter((provider) => {
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
      if (providerKinds.size) {
        let matches = false;
        for (const kind of kindFilter) {
          if (providerKinds.has(kind)) {
            matches = true;
            break;
          }
        }
        if (!matches) continue;
      }
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

  const selectedGroups = new Map(), suppressed = new Set();
  for (const plan of plans) {
    const group = plan.provider.exclusiveLanguageGroup;
    if (!group) continue;
    if (selectedGroups.has(group)) throw Object.assign(new Error(`Multiple explicit providers selected for ${group}: ${selectedGroups.get(group)}, ${plan.provider.id}.`), {
      code: 'ERR_TOOLING_PROVIDER_SELECTION'
    });
    selectedGroups.set(group, plan.provider.id);
    for (const id of plan.provider.replacesProviderIds || []) suppressed.add(normalizeProviderId(id));
  }
  return plans.filter(plan => !suppressed.has(normalizeProviderId(plan.provider.id)));
}
