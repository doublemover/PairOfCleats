const normalizeLimit = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.max(0, Math.floor(numeric));
};

export const normalizeRelationSignalToken = (raw) => {
  if (typeof raw !== 'string') return '';
  const normalized = raw.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  return normalized.length > 256
    ? normalized.slice(0, 256)
    : normalized;
};

export const countRelationSignalEntries = (relations) => ({
  calls: Array.isArray(relations?.calls) ? relations.calls.length : 0,
  callDetails: Array.isArray(relations?.callDetails) ? relations.callDetails.length : 0,
  usages: Array.isArray(relations?.usages) ? relations.usages.length : 0
});

const applyArrayBudget = ({ owner, key, limit }) => {
  if (!owner || typeof owner !== 'object') {
    return { before: 0, after: 0, dropped: 0 };
  }
  const list = owner[key];
  const before = Array.isArray(list) ? list.length : 0;
  if (!Array.isArray(list) || limit == null || before <= limit) {
    return { before, after: before, dropped: 0 };
  }
  owner[key] = list.slice(0, limit);
  return { before, after: owner[key].length, dropped: before - owner[key].length };
};

export const applyRelationInferenceBudget = ({
  relations,
  maxCalls = null,
  maxCallDetails = null,
  maxUsages = null,
  ensureUsageArray = false
}) => {
  if (!relations || typeof relations !== 'object') {
    return {
      calls: { before: 0, after: 0, dropped: 0 },
      callDetails: { before: 0, after: 0, dropped: 0 },
      usages: { before: 0, after: 0, dropped: 0 }
    };
  }
  if (ensureUsageArray && !Array.isArray(relations.usages)) {
    relations.usages = [];
  }
  return {
    calls: applyArrayBudget({
      owner: relations,
      key: 'calls',
      limit: normalizeLimit(maxCalls)
    }),
    callDetails: applyArrayBudget({
      owner: relations,
      key: 'callDetails',
      limit: normalizeLimit(maxCallDetails)
    }),
    usages: applyArrayBudget({
      owner: relations,
      key: 'usages',
      limit: normalizeLimit(maxUsages)
    })
  };
};

export const applyFileUsageInferenceBudget = ({ fileRelations, maxUsages = null }) => (
  applyArrayBudget({
    owner: fileRelations,
    key: 'usages',
    limit: normalizeLimit(maxUsages)
  })
);

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
    importBindings: relations.importBindings && typeof relations.importBindings === 'object'
      ? relations.importBindings
      : null,
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
    importBindings,
    functionMeta,
    classMeta,
    ...rest
  } = codeRelations;
  return rest;
};
