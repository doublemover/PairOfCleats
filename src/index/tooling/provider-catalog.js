import { normalizeProviderId } from './provider-contract.js';

const configurationOrigins = new WeakMap();
const projectOrigin = origin => Object.freeze({
  kind: typeof origin?.kind === 'string' ? origin.kind.slice(0, 64) : 'provider',
  source: typeof origin?.source === 'string' ? origin.source.slice(0, 512) : 'unknown',
  rawId: typeof origin?.rawId === 'string' ? origin.rawId.slice(0, 256) : null
});
export const setProviderCatalogOrigin = (provider, origin) => {
  configurationOrigins.set(provider, projectOrigin(origin)); return provider;
};
export const createProviderCatalogError = (code, providerId, origins, message) => Object.assign(new Error(message), {
  code, providerId, origins: Object.freeze(origins.map(projectOrigin))
});

/** Admit one identity catalog before allow/deny, ordering, preflight or cache
 * work. Even equivalent duplicate objects are rejected: execution multiplicity
 * never depends on an ordering override. Origins exclude commands/arguments.
 */
export const admitProviderCatalog = (providers, origins = null) => {
  const catalog = new Map(), owners = new Map();
  for (let index = 0; index < providers.length; index++) {
    const provider = providers[index], id = normalizeProviderId(provider?.id);
    const origin = projectOrigin(origins?.[index] || configurationOrigins.get(provider)
      || { kind: 'provider', source: `provider[${index}]`, rawId: provider?.id });
    if (!id) throw createProviderCatalogError('ERR_TOOLING_PROVIDER_CATALOG', null, [origin], 'Provider catalog identity is missing.');
    if (catalog.has(id)) {
      const previous = owners.get(id);
      throw createProviderCatalogError('ERR_TOOLING_PROVIDER_ID_COLLISION', id, [previous, origin],
        `Normalized provider ID ${id.slice(0, 256)} collides between ${previous.source} and ${origin.source}. Select distinct explicit provider IDs.`);
    }
    catalog.set(id, provider); owners.set(id, origin);
  }
  return catalog;
};
