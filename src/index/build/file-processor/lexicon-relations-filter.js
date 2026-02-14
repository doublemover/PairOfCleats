import { extractSymbolBaseName, getLanguageLexicon } from '../../../lang/lexicon/index.js';

const DEFAULT_DROP_CONFIG = Object.freeze({
  keywords: true,
  literals: true,
  builtins: false,
  types: false
});

const asPlainObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : null
);

const normalizeBool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

const normalizeToken = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const resolveDropConfig = ({ languageId, config }) => {
  const cfg = asPlainObject(config) || {};
  const relations = asPlainObject(cfg.relations) || {};
  const languageOverrides = asPlainObject(cfg.languageOverrides) || {};
  const languageOverride = asPlainObject(languageOverrides[languageId || '_generic']) || {};
  const languageRelations = asPlainObject(languageOverride.relations) || {};
  const globalDrop = asPlainObject(relations.drop) || {};
  const languageDrop = asPlainObject(languageRelations.drop) || {};

  const defaults = { ...DEFAULT_DROP_CONFIG };
  const merged = {
    ...defaults,
    ...languageDrop,
    ...globalDrop
  };

  return {
    keywords: normalizeBool(merged.keywords, defaults.keywords),
    literals: normalizeBool(merged.literals, defaults.literals),
    builtins: normalizeBool(merged.builtins, defaults.builtins),
    types: normalizeBool(merged.types, defaults.types),
    stableDedupe: normalizeBool(relations.stableDedupe, false)
  };
};

const buildDropSet = (lexicon, dropConfig) => {
  const set = new Set();
  const maybeAdd = (enabled, values) => {
    if (!enabled || !(values instanceof Set)) return;
    for (const value of values) set.add(value);
  };
  maybeAdd(dropConfig.keywords, lexicon.keywords);
  maybeAdd(dropConfig.literals, lexicon.literals);
  maybeAdd(dropConfig.builtins, lexicon.builtins);
  maybeAdd(dropConfig.types, lexicon.types);
  return set;
};

const classifyToken = (token, lexicon) => {
  if (!token) return null;
  if (lexicon.keywords instanceof Set && lexicon.keywords.has(token)) return 'keywords';
  if (lexicon.literals instanceof Set && lexicon.literals.has(token)) return 'literals';
  if (lexicon.builtins instanceof Set && lexicon.builtins.has(token)) return 'builtins';
  if (lexicon.types instanceof Set && lexicon.types.has(token)) return 'types';
  return null;
};

const createStats = () => ({
  droppedCalls: 0,
  droppedUsages: 0,
  droppedCallDetails: 0,
  droppedCallDetailsWithRange: 0,
  droppedCallsByCategory: {
    keywords: 0,
    literals: 0,
    builtins: 0,
    types: 0
  },
  droppedUsagesByCategory: {
    keywords: 0,
    literals: 0,
    builtins: 0,
    types: 0
  }
});

const bumpCategory = (bucket, category) => {
  if (!category || !bucket || !Object.prototype.hasOwnProperty.call(bucket, category)) return;
  bucket[category] += 1;
};

const maybeLogStats = ({ stats, languageId, relKey, log }) => {
  if (typeof log !== 'function') return;
  const total = stats.droppedCalls + stats.droppedUsages + stats.droppedCallDetails + stats.droppedCallDetailsWithRange;
  if (!total) return;
  log(
    `lexicon.relations.filtered language=${languageId || '_generic'} file=${relKey || '-'} ` +
    `callsDropped=${stats.droppedCalls} usagesDropped=${stats.droppedUsages}`
  );
};

export const filterRawRelationsWithLexicon = (rawRelations, {
  languageId = null,
  lexicon = null,
  config = null,
  log = null,
  relKey = null
} = {}) => {
  if (!rawRelations || typeof rawRelations !== 'object') return rawRelations;

  const cfg = asPlainObject(config) || {};
  const lexiconEnabled = cfg.enabled !== false;
  const relationsConfig = asPlainObject(cfg.relations) || {};
  const relationsEnabled = relationsConfig.enabled !== false;
  if (!lexiconEnabled || !relationsEnabled) return rawRelations;

  let resolvedLexicon;
  try {
    if (lexicon && typeof lexicon.getLanguageLexicon === 'function') {
      resolvedLexicon = lexicon.getLanguageLexicon(languageId, { allowFallback: true });
    } else if (lexicon && typeof lexicon.get === 'function') {
      resolvedLexicon = lexicon.get(languageId);
    } else if (lexicon && typeof lexicon === 'object' && lexicon.stopwords) {
      resolvedLexicon = lexicon;
    } else {
      resolvedLexicon = getLanguageLexicon(languageId, { allowFallback: true });
    }
  } catch {
    return rawRelations;
  }

  if (!resolvedLexicon || typeof resolvedLexicon !== 'object') return rawRelations;

  const dropConfig = resolveDropConfig({ languageId: languageId || resolvedLexicon.languageId, config: cfg });
  const dropSet = buildDropSet(resolvedLexicon, dropConfig);
  if (!dropSet.size) return rawRelations;

  const stableDedupe = dropConfig.stableDedupe === true;
  const stats = createStats();

  const filtered = { ...rawRelations };

  if (Array.isArray(rawRelations.usages)) {
    const usages = [];
    const seen = new Set();
    for (const entry of rawRelations.usages) {
      const normalized = normalizeToken(entry);
      if (!normalized) continue;
      if (dropSet.has(normalized)) {
        stats.droppedUsages += 1;
        bumpCategory(stats.droppedUsagesByCategory, classifyToken(normalized, resolvedLexicon));
        continue;
      }
      if (stableDedupe) {
        if (seen.has(normalized)) continue;
        seen.add(normalized);
      }
      usages.push(entry);
    }
    filtered.usages = usages;
  }

  if (Array.isArray(rawRelations.calls)) {
    const calls = [];
    const seen = new Set();
    for (const entry of rawRelations.calls) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const caller = entry[0];
      const callee = entry[1];
      const base = normalizeToken(extractSymbolBaseName(callee));
      if (!base) continue;
      if (dropSet.has(base)) {
        stats.droppedCalls += 1;
        bumpCategory(stats.droppedCallsByCategory, classifyToken(base, resolvedLexicon));
        continue;
      }
      if (stableDedupe) {
        const tuple = `${String(caller)}|${String(callee)}`;
        if (seen.has(tuple)) continue;
        seen.add(tuple);
      }
      calls.push(entry);
    }
    filtered.calls = calls;
  }

  if (Array.isArray(rawRelations.callDetails)) {
    const callDetails = [];
    const seen = new Set();
    for (const detail of rawRelations.callDetails) {
      const base = normalizeToken(extractSymbolBaseName(detail?.callee));
      if (!base) continue;
      if (dropSet.has(base)) {
        stats.droppedCallDetails += 1;
        continue;
      }
      if (stableDedupe) {
        const key = `${String(detail?.caller || '')}|${String(detail?.callee || '')}|${Number(detail?.line) || 0}|${Number(detail?.col) || 0}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      callDetails.push(detail);
    }
    filtered.callDetails = callDetails;
  }

  if (Array.isArray(rawRelations.callDetailsWithRange)) {
    const callDetailsWithRange = [];
    const seen = new Set();
    for (const detail of rawRelations.callDetailsWithRange) {
      const base = normalizeToken(extractSymbolBaseName(detail?.callee));
      if (!base) continue;
      if (dropSet.has(base)) {
        stats.droppedCallDetailsWithRange += 1;
        continue;
      }
      if (stableDedupe) {
        const range = detail?.range && typeof detail.range === 'object'
          ? `${detail.range.start || ''}:${detail.range.end || ''}`
          : '';
        const key = `${String(detail?.caller || '')}|${String(detail?.callee || '')}|${range}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      callDetailsWithRange.push(detail);
    }
    filtered.callDetailsWithRange = callDetailsWithRange;
  }

  maybeLogStats({ stats, languageId: languageId || resolvedLexicon.languageId, relKey, log });
  return filtered;
};
