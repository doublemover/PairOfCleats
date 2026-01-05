export const uniqueTypes = (values) => Array.from(new Set((values || []).filter(Boolean)));

export const createToolingEntry = () => ({
  returns: [],
  params: {},
  signature: '',
  paramNames: []
});

export const mergeToolingEntry = (target, incoming) => {
  if (!incoming) return target;
  if (incoming.signature && !target.signature) target.signature = incoming.signature;
  if (incoming.paramNames?.length && (!target.paramNames || !target.paramNames.length)) {
    target.paramNames = incoming.paramNames.slice();
  }
  if (Array.isArray(incoming.returns) && incoming.returns.length) {
    target.returns = uniqueTypes([...(target.returns || []), ...incoming.returns]);
  }
  if (incoming.params && typeof incoming.params === 'object') {
    if (!target.params || typeof target.params !== 'object') target.params = {};
    for (const [name, types] of Object.entries(incoming.params)) {
      if (!name || !Array.isArray(types)) continue;
      const existing = target.params[name] || [];
      target.params[name] = uniqueTypes([...(existing || []), ...types]);
    }
  }
  return target;
};

export const mergeToolingMaps = (base, incoming) => {
  for (const [key, value] of incoming || []) {
    if (!base.has(key)) {
      const entry = createToolingEntry();
      mergeToolingEntry(entry, value);
      base.set(key, entry);
      continue;
    }
    mergeToolingEntry(base.get(key), value);
  }
  return base;
};
