export const buildCallIndex = (relations) => {
  if (!relations) return null;
  const callsByCaller = new Map();
  if (Array.isArray(relations.calls)) {
    for (const entry of relations.calls) {
      if (!entry || entry.length < 2) continue;
      const caller = entry[0];
      if (!caller) continue;
      const list = callsByCaller.get(caller) || [];
      list.push(entry);
      callsByCaller.set(caller, list);
    }
  }
  const callDetailsByCaller = new Map();
  const callDetailsWithRange = [];
  if (Array.isArray(relations.callDetails)) {
    for (const detail of relations.callDetails) {
      const caller = detail?.caller;
      if (!caller) continue;
      if (Number.isFinite(detail?.start) && Number.isFinite(detail?.end)) {
        callDetailsWithRange.push(detail);
      }
      const list = callDetailsByCaller.get(caller) || [];
      list.push(detail);
      callDetailsByCaller.set(caller, list);
    }
  }
  return { callsByCaller, callDetailsByCaller, callDetailsWithRange };
};

export const buildFileRelations = (relations, relKey = null) => {
  if (!relations) return null;
  const normalizeList = (list, exclude = null) => {
    const set = new Set();
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (typeof entry === 'string' && entry) set.add(entry);
      }
    }
    if (exclude) set.delete(exclude);
    const output = Array.from(set);
    output.sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
    return output;
  };
  return {
    imports: normalizeList(relations.imports),
    exports: normalizeList(relations.exports),
    usages: normalizeList(relations.usages),
    importLinks: normalizeList(relations.importLinks, relKey),
    functionMeta: relations.functionMeta && typeof relations.functionMeta === 'object'
      ? relations.functionMeta
      : {},
    classMeta: relations.classMeta && typeof relations.classMeta === 'object'
      ? relations.classMeta
      : {}
  };
};

export const stripFileRelations = (codeRelations) => {
  if (!codeRelations || typeof codeRelations !== 'object') return codeRelations;
  const {
    imports,
    exports,
    usages,
    importLinks,
    functionMeta,
    classMeta,
    ...rest
  } = codeRelations;
  return rest;
};
