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
    sourceRule: normalizeFilterList(filters.sourceRule ?? filters.source_rule),
    sinkRule: normalizeFilterList(filters.sinkRule ?? filters.sink_rule),
    flowId: normalizeFilterList(filters.flowId ?? filters.flow_id)
  };
  return Object.values(normalized).some((entry) => entry.length) ? normalized : null;
};

export const normalizeRiskFilters = (filters) => normalizeRiskFilterObject(filters);

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

export const matchesRiskFilters = (flow, filters) => {
  if (!filters) return true;
  const ruleSet = new Set(filters.rule || []);
  const categorySet = new Set(filters.category || []);
  const severitySet = new Set(filters.severity || []);
  const tagSet = new Set(filters.tag || []);
  const sourceSet = new Set(filters.source || []);
  const sinkSet = new Set(filters.sink || []);
  const sourceRuleSet = new Set(filters.sourceRule || []);
  const sinkRuleSet = new Set(filters.sinkRule || []);
  const flowIdSet = new Set(filters.flowId || []);

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
  if (!Array.isArray(flows) || !flows.length) return [];
  if (!filters) return flows.slice();
  return flows.filter((flow) => matchesRiskFilters(flow, filters));
};

export const matchesRiskPartialFilters = (flow, filters) => {
  if (!filters) return true;
  const ruleSet = new Set(filters.rule || []);
  const categorySet = new Set(filters.category || []);
  const severitySet = new Set(filters.severity || []);
  const tagSet = new Set(filters.tag || []);
  const sourceSet = new Set(filters.source || []);
  const sinkSet = new Set(filters.sink || []);
  const sourceRuleSet = new Set(filters.sourceRule || []);
  const sinkRuleSet = new Set(filters.sinkRule || []);
  const flowIdSet = new Set(filters.flowId || []);

  if (flowIdSet.size && !flowIdSet.has(flow?.partialFlowId || '')) return false;
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
  if (!Array.isArray(flows) || !flows.length) return [];
  if (!filters) return flows.slice();
  return flows.filter((flow) => matchesRiskPartialFilters(flow, filters));
};
