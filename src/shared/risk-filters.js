import { toStringArray } from './iterables.js';

const RISK_SEVERITY_LEVELS = new Set(['low', 'medium', 'high', 'critical']);

export const EMPTY_RISK_FILTERS = Object.freeze({
  rule: Object.freeze([]),
  category: Object.freeze([]),
  severity: Object.freeze([]),
  tag: Object.freeze([]),
  source: Object.freeze([]),
  sink: Object.freeze([]),
  sourceRule: Object.freeze([]),
  sinkRule: Object.freeze([]),
  flowId: Object.freeze([])
});

const normalizeFilterList = (value, { lower = false } = {}) => {
  const rawEntries = [];
  if (Array.isArray(value)) {
    rawEntries.push(...value);
  } else if (typeof value === 'string') {
    rawEntries.push(...value.split(','));
  } else if (value != null) {
    rawEntries.push(value);
  }
  const normalized = [];
  for (const entry of rawEntries) {
    const items = typeof entry === 'string' ? entry.split(',') : [entry];
    normalized.push(...toStringArray(items, { lower }));
  }
  return Array.from(new Set(normalized));
};

const normalizeRiskFilterObject = (filters) => {
  if (!filters || typeof filters !== 'object') return null;
  const normalized = {
    rule: normalizeFilterList(filters.rule ?? filters.ruleId),
    category: normalizeFilterList(filters.category),
    severity: normalizeFilterList(filters.severity, { lower: true }),
    tag: normalizeFilterList(filters.tag ?? filters.tags),
    source: normalizeFilterList(filters.source),
    sink: normalizeFilterList(filters.sink),
    sourceRule: normalizeFilterList(filters.sourceRule ?? filters.source_rule ?? filters['source-rule']),
    sinkRule: normalizeFilterList(filters.sinkRule ?? filters.sink_rule ?? filters['sink-rule']),
    flowId: normalizeFilterList(filters.flowId ?? filters.flow_id ?? filters['flow-id'])
  };
  return Object.values(normalized).some((entry) => entry.length) ? normalized : null;
};

export const normalizeRiskFilters = (filters) => normalizeRiskFilterObject(filters);

export const buildRiskFilterInput = (input = {}) => {
  const source = input && typeof input === 'object' ? input : {};
  return {
    rule: source.rule,
    category: source.category,
    severity: source.severity,
    tag: source.tag,
    source: source.source,
    sink: source.sink,
    flowId: source.flowId ?? source.flow_id ?? source['flow-id'],
    sourceRule: source.sourceRule ?? source.source_rule ?? source['source-rule'],
    sinkRule: source.sinkRule ?? source.sink_rule ?? source['sink-rule']
  };
};

export const materializeRiskFilters = (filters) => {
  const normalized = normalizeRiskFilterObject(filters);
  return normalized ? {
    rule: normalized.rule.slice(),
    category: normalized.category.slice(),
    severity: normalized.severity.slice(),
    tag: normalized.tag.slice(),
    source: normalized.source.slice(),
    sink: normalized.sink.slice(),
    sourceRule: normalized.sourceRule.slice(),
    sinkRule: normalized.sinkRule.slice(),
    flowId: normalized.flowId.slice()
  } : {
    rule: [],
    category: [],
    severity: [],
    tag: [],
    source: [],
    sink: [],
    sourceRule: [],
    sinkRule: [],
    flowId: []
  };
};

export const validateRiskFilters = (filters) => {
  if (!filters) return { ok: true, errors: [] };
  const errors = [];
  for (const severity of Array.isArray(filters.severity) ? filters.severity : []) {
    if (!RISK_SEVERITY_LEVELS.has(severity)) {
      errors.push(`severity must be one of ${Array.from(RISK_SEVERITY_LEVELS).join(', ')} (received "${severity}")`);
    }
  }
  return { ok: errors.length === 0, errors };
};

export const buildNormalizedRiskFilters = (input = {}) => normalizeRiskFilters(buildRiskFilterInput(input));

export const normalizeValidatedRiskFilters = (filters) => {
  const normalized = normalizeRiskFilters(filters);
  const validation = validateRiskFilters(normalized);
  return {
    filters: normalized,
    validation,
    ok: validation.ok,
    errors: validation.errors
  };
};

export const buildValidatedRiskFilters = (input = {}) => normalizeValidatedRiskFilters(buildRiskFilterInput(input));

const includesAny = (setLike, values) => {
  if (!(setLike instanceof Set) || setLike.size === 0) return false;
  for (const value of values) {
    if (value && setLike.has(value)) return true;
  }
  return false;
};

const collectEndpointLabels = (endpoint) => {
  if (!endpoint || typeof endpoint !== 'object') return [];
  return [
    endpoint.ruleId || '',
    endpoint.ruleName || '',
    endpoint.name || ''
  ].filter(Boolean);
};

const buildRiskFilterSets = (filters) => ({
  ruleSet: new Set(filters?.rule || []),
  categorySet: new Set(filters?.category || []),
  severitySet: new Set(filters?.severity || []),
  tagSet: new Set(filters?.tag || []),
  sourceSet: new Set(filters?.source || []),
  sinkSet: new Set(filters?.sink || []),
  sourceRuleSet: new Set(filters?.sourceRule || []),
  sinkRuleSet: new Set(filters?.sinkRule || []),
  flowIdSet: new Set(filters?.flowId || [])
});

const filterRiskFlowList = (flows, filters, matcher) => {
  if (!Array.isArray(flows) || !flows.length) return [];
  if (!filters) return flows.slice();
  return flows.filter((flow) => matcher(flow, filters));
};

export const matchesRiskFilters = (flow, filters) => {
  if (!filters) return true;
  const {
    ruleSet,
    categorySet,
    severitySet,
    tagSet,
    sourceSet,
    sinkSet,
    sourceRuleSet,
    sinkRuleSet,
    flowIdSet
  } = buildRiskFilterSets(filters);

  if (flowIdSet.size && !flowIdSet.has(flow?.flowId || '')) return false;
  if (sourceSet.size && !includesAny(sourceSet, collectEndpointLabels(flow?.source))) return false;
  if (sinkSet.size && !includesAny(sinkSet, collectEndpointLabels(flow?.sink))) return false;
  if (sourceRuleSet.size && !sourceRuleSet.has(flow?.source?.ruleId || '')) return false;
  if (sinkRuleSet.size && !sinkRuleSet.has(flow?.sink?.ruleId || '')) return false;
  if (ruleSet.size && !includesAny(ruleSet, [flow?.source?.ruleId || '', flow?.sink?.ruleId || ''])) return false;
  if (categorySet.size && !includesAny(categorySet, [
    flow?.category || '',
    flow?.source?.category || '',
    flow?.sink?.category || ''
  ])) return false;
  if (severitySet.size && !includesAny(severitySet, [
    String(flow?.severity || '').toLowerCase(),
    String(flow?.source?.severity || '').toLowerCase(),
    String(flow?.sink?.severity || '').toLowerCase()
  ])) return false;
  if (tagSet.size && !includesAny(tagSet, [
    ...(Array.isArray(flow?.source?.tags) ? flow.source.tags : []),
    ...(Array.isArray(flow?.sink?.tags) ? flow.sink.tags : [])
  ])) return false;
  return true;
};

export const filterRiskFlows = (flows, filters) => {
  return filterRiskFlowList(flows, filters, matchesRiskFilters);
};

export const matchesRiskPartialFilters = (flow, filters) => {
  if (!filters) return true;
  const {
    ruleSet,
    categorySet,
    severitySet,
    tagSet,
    sourceSet,
    sinkSet,
    sourceRuleSet,
    sinkRuleSet
  } = buildRiskFilterSets(filters);

  if (sourceSet.size && !includesAny(sourceSet, collectEndpointLabels(flow?.source))) return false;
  if (sinkSet.size) {
    const frontierLabels = [
      flow?.frontier?.chunkUid || '',
      flow?.frontier?.terminalReason || ''
    ].filter(Boolean);
    if (!includesAny(sinkSet, frontierLabels)) return false;
  }
  if (sourceRuleSet.size && !sourceRuleSet.has(flow?.source?.ruleId || '')) return false;
  if (sinkRuleSet.size) return false;
  if (ruleSet.size && !includesAny(ruleSet, [flow?.source?.ruleId || ''])) return false;
  if (categorySet.size && !includesAny(categorySet, [flow?.source?.category || ''])) return false;
  if (severitySet.size && !includesAny(severitySet, [String(flow?.source?.severity || '').toLowerCase()])) return false;
  if (tagSet.size && !includesAny(tagSet, Array.isArray(flow?.source?.tags) ? flow.source.tags : [])) return false;
  return true;
};

export const filterRiskPartialFlows = (flows, filters) => {
  return filterRiskFlowList(flows, filters, matchesRiskPartialFilters);
};
