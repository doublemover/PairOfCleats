import { createSafeRegex } from '../../../shared/safe-regex.js';
import { fileAnalysisProtocolError } from './file-analysis-errors.js';

const projectPattern = pattern => {
  const native = pattern instanceof RegExp;
  if (!native && Object.getPrototypeOf(pattern || {})?.constructor?.name !== 'SafeRegex') {
    throw fileAnalysisProtocolError('risk-regex-owner');
  }
  return { type: native ? 'RegExp' : 'SafeRegex', source: pattern.source, flags: pattern.flags,
    engine: native ? null : pattern.engine, config: native ? null : pattern.config,
    prefilter: pattern.prefilter ?? null, prefilterLower: pattern.prefilterLower ?? null };
};
const mapRules = (config, transform) => {
  if (!config?.rules) return config;
  const rules = { ...config.rules };
  for (const role of ['sources', 'sinks', 'sanitizers']) {
    if (!Array.isArray(rules[role])) continue;
    rules[role] = rules[role].map(rule => {
      if (!rule || !Array.isArray(rule.patterns)) throw fileAnalysisProtocolError('risk-rule-owner');
      return { ...rule, patterns: rule.patterns.map(transform), requires: rule.requires ? transform(rule.requires) : null };
    });
  }
  return { ...config, rules };
};

// Copy exact already-normalized regex policy/provenance; native compiled
// handles remain with the source owner. Worker compilation never changes engine.
export const projectFileAnalysisRisk = config => mapRules(config, projectPattern);
export const restoreFileAnalysisRisk = config => mapRules(config, pattern => {
  if (!pattern || typeof pattern.source !== 'string' || typeof pattern.flags !== 'string'
    || !['RegExp', 'SafeRegex'].includes(pattern.type)) throw fileAnalysisProtocolError('risk-regex-projection');
  const regex = pattern.type === 'RegExp' ? new RegExp(pattern.source, pattern.flags)
    : createSafeRegex(pattern.source, pattern.flags, { ...pattern.config, engine: pattern.engine });
  if (!regex || (pattern.type === 'SafeRegex' && regex.engine !== pattern.engine)) throw fileAnalysisProtocolError('risk-regex-engine');
  if (pattern.prefilter != null) regex.prefilter = pattern.prefilter;
  if (pattern.prefilterLower != null) regex.prefilterLower = pattern.prefilterLower;
  return regex;
});
