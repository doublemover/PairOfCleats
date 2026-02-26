import { extractSymbolBaseName, getLanguageLexicon } from '../../../lang/lexicon/index.js';
import { isPlainObject, normalizeBoolean } from '../../../shared/config.js';

const DEFAULT_DROP_CONFIG = Object.freeze({
  keywords: true,
  literals: true,
  builtins: false,
  types: false
});

const asPlainObject = (value) => (isPlainObject(value) ? value : null);

const normalizeToken = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};
const toDedupeKeyPart = (value) => (value ?? '') === '' ? '' : String(value);

const resolveRelationsScopes = ({ languageId, config }) => {
  const cfg = asPlainObject(config) || {};
  const relations = asPlainObject(cfg.relations) || {};
  const languageOverrides = asPlainObject(cfg.languageOverrides) || {};
  const languageOverride = asPlainObject(languageOverrides[languageId || '_generic']) || {};
  const languageRelations = asPlainObject(languageOverride.relations) || {};
  return { relations, languageRelations };
};

const resolveRelationsEnabled = ({ languageId, config }) => {
  const { relations, languageRelations } = resolveRelationsScopes({ languageId, config });
  return normalizeBoolean(
    languageRelations.enabled,
    normalizeBoolean(relations.enabled, true)
  );
};

const resolveDropConfig = ({ languageId, config }) => {
  const { relations, languageRelations } = resolveRelationsScopes({ languageId, config });
  const globalDrop = asPlainObject(relations.drop) || {};
  const languageDrop = asPlainObject(languageRelations.drop) || {};

  const defaults = { ...DEFAULT_DROP_CONFIG };
  const merged = {
    ...defaults,
    ...globalDrop,
    ...languageDrop
  };

  return {
    keywords: normalizeBoolean(merged.keywords, defaults.keywords),
    literals: normalizeBoolean(merged.literals, defaults.literals),
    builtins: normalizeBoolean(merged.builtins, defaults.builtins),
    types: normalizeBoolean(merged.types, defaults.types),
    stableDedupe: normalizeBoolean(
      languageRelations.stableDedupe,
      normalizeBoolean(relations.stableDedupe, false)
    )
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
  if (total <= 0) return;
  const counters = [];
  if (stats.droppedCalls > 0) counters.push(`callsDropped=${stats.droppedCalls}`);
  if (stats.droppedUsages > 0) counters.push(`usagesDropped=${stats.droppedUsages}`);
  if (stats.droppedCallDetails > 0) counters.push(`callDetailsDropped=${stats.droppedCallDetails}`);
  if (stats.droppedCallDetailsWithRange > 0) counters.push(`callDetailsRangeDropped=${stats.droppedCallDetailsWithRange}`);
  counters.push(`totalDropped=${total}`);
  log(`lexicon.relations.filtered language=${languageId || '_generic'} file=${relKey || '-'} ${counters.join(' ')}`);
};

const attachFilterStats = (relations, stats, languageId, relKey) => {
  if (!relations || typeof relations !== 'object' || !stats) return relations;
  const value = {
    languageId: languageId || '_generic',
    file: relKey || null,
    droppedCalls: stats.droppedCalls,
    droppedUsages: stats.droppedUsages,
    droppedCallDetails: stats.droppedCallDetails,
    droppedCallDetailsWithRange: stats.droppedCallDetailsWithRange,
    droppedTotal: stats.droppedCalls + stats.droppedUsages + stats.droppedCallDetails + stats.droppedCallDetailsWithRange,
    droppedCallsByCategory: { ...stats.droppedCallsByCategory },
    droppedUsagesByCategory: { ...stats.droppedUsagesByCategory }
  };
  if (Object.prototype.hasOwnProperty.call(relations, '__lexiconFilterStats')) {
    try {
      Object.defineProperty(relations, '__lexiconFilterStats', {
        value,
        enumerable: false,
        writable: false,
        configurable: true
      });
    } catch {}
    return relations;
  }
  Object.defineProperty(relations, '__lexiconFilterStats', {
    value,
    enumerable: false,
    writable: false,
    configurable: true
  });
  return relations;
};

export const getLexiconRelationFilterStats = (relations) => (
  relations && typeof relations === 'object' && relations.__lexiconFilterStats
    ? relations.__lexiconFilterStats
    : null
);

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
  if (!lexiconEnabled) return rawRelations;

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

  const resolvedLanguageId = languageId || resolvedLexicon.languageId || '_generic';
  const relationsEnabled = resolveRelationsEnabled({ languageId: resolvedLanguageId, config: cfg });
  if (!relationsEnabled) return rawRelations;

  const dropConfig = resolveDropConfig({ languageId: resolvedLanguageId, config: cfg });
  const dropSet = buildDropSet(resolvedLexicon, dropConfig);
  const stableDedupe = dropConfig.stableDedupe === true;
  if (!dropSet.size && !stableDedupe) return rawRelations;
  const stats = createStats();

  const filtered = rawRelations;

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
      const normalizedCallee = normalizeToken(String(callee ?? ''));
      const base = normalizeToken(extractSymbolBaseName(callee));
      if (!base) continue;
      const tokenCategory = classifyToken(base, resolvedLexicon);
      // Preserve qualified member lookups (for example `obj.default`) so
      // keyword-like member names do not get dropped as bare-language tokens.
      const qualifiedMemberCall = normalizedCallee.includes('.')
        || normalizedCallee.includes('::')
        || normalizedCallee.includes('->')
        || normalizedCallee.includes('#')
        || normalizedCallee.includes('/');
      const preserveQualifiedKeywordMember = qualifiedMemberCall && tokenCategory === 'keywords';
      if (dropSet.has(base) && !preserveQualifiedKeywordMember) {
        stats.droppedCalls += 1;
        bumpCategory(stats.droppedCallsByCategory, tokenCategory);
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
        const start = toDedupeKeyPart(detail?.start);
        const line = toDedupeKeyPart(detail?.startLine ?? detail?.line);
        const col = toDedupeKeyPart(detail?.startCol ?? detail?.col);
        const key = `${String(detail?.caller || '')}|${String(detail?.callee || '')}|${start}|${line}|${col}`;
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
          ? `${detail.range.start ?? ''}:${detail.range.end ?? ''}`
          : '';
        const key = `${String(detail?.caller || '')}|${String(detail?.callee || '')}|${range}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      callDetailsWithRange.push(detail);
    }
    filtered.callDetailsWithRange = callDetailsWithRange;
  }

  maybeLogStats({ stats, languageId: resolvedLanguageId, relKey, log });
  return attachFilterStats(filtered, stats, resolvedLanguageId, relKey);
};
