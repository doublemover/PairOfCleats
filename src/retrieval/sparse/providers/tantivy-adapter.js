/** API-shape admission without loading a native package or its ranking graph. */
export const resolveTantivyAdapter = mod => {
  if (!mod) return null;
  const api = mod.default && Object.keys(mod).length === 1 ? mod.default : mod;
  const openIndex = api.openIndex || api.open;
  const searchIndex = api.search || api.searchIndex;
  const closeIndex = api.closeIndex || api.close;
  return typeof openIndex === 'function' && typeof searchIndex === 'function'
    ? { openIndex: openIndex.bind(api), searchIndex: searchIndex.bind(api),
      closeIndex: typeof closeIndex === 'function' ? closeIndex.bind(api) : null } : null;
};
export const hasTantivyAdapter = mod => Boolean(resolveTantivyAdapter(mod));
