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
  if (Array.isArray(relations.callDetails)) {
    for (const detail of relations.callDetails) {
      const caller = detail?.caller;
      if (!caller) continue;
      const list = callDetailsByCaller.get(caller) || [];
      list.push(detail);
      callDetailsByCaller.set(caller, list);
    }
  }
  return { callsByCaller, callDetailsByCaller };
};

export const buildFileRelations = (relations) => {
  if (!relations) return null;
  return {
    imports: Array.isArray(relations.imports) ? relations.imports : [],
    exports: Array.isArray(relations.exports) ? relations.exports : [],
    usages: Array.isArray(relations.usages) ? relations.usages : [],
    importLinks: Array.isArray(relations.importLinks) ? relations.importLinks : [],
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
