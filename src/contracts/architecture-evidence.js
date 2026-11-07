import { createHash } from 'node:crypto';
import { ARCHITECTURE_RULES_VERSION } from './architecture-rules.js';

export const ARCHITECTURE_REPORT_VERSION = '1.1.0';
export const architectureEvidenceHash = value => createHash('sha256')
  .update('pairofcleats.architecture-evidence.v1\0').update(JSON.stringify(value)).digest('hex');
const endpointIdentity = ref => ref.type === 'file' ? { type: ref.type, path: ref.path }
  : ref.type === 'chunk' ? { type: ref.type, chunkUid: ref.chunkUid } : { type: ref.type, symbolId: ref.symbolId };
export const architectureEdgeId = (edgeType, from, to) => architectureEvidenceHash({ edgeType,
  from: endpointIdentity(from), to: endpointIdentity(to) });
const selector = value => ({ anyOf: value.anyOf || [], noneOf: value.noneOf || [] });
/** Fixed property order, normalized defaults and ordered rule/layer/pattern
 * arrays. Text inside a glob remains significant; JSON/YAML whitespace does not.
 */
export const architecturePolicyReceipt = rules => {
  const normalized = rules.map(rule => ({ id: rule.id, type: rule.type, severity: rule.severity,
    message: rule.message, ...(rule.type === 'layering'
      ? { layers: rule.layers.map(layer => ({ name: layer.name, match: selector(layer.match) })) }
      : { from: selector(rule.from), to: selector(rule.to) }) }));
  const encoded = JSON.stringify({ version: ARCHITECTURE_RULES_VERSION, rules: normalized });
  return { normalized, encoded, receipt: { schemaVersion: 1, rulesVersion: ARCHITECTURE_RULES_VERSION,
    digest: architectureEvidenceHash({ policy: encoded }), algorithm: 'sha256',
    normalization: 'ordered-admitted-policy-v1', pathNormalization: 'repo-relative-path-v1', layerSelection: 'first-match' } };
};
const boundedText = (value, max = 256) => {
  if (typeof value !== 'string' || !value) return null;
  let end = Math.min(value.length, max);
  if (end < value.length && /[\uD800-\uDBFF]/u.test(value[end - 1])) end--;
  return value.slice(0, end);
};
const declarationLabel = node => {
  for (const key of ['name', 'label', 'symbolName']) {
    const field = node && Object.getOwnPropertyDescriptor(node, key);
    if (field && Object.hasOwn(field, 'value') && typeof field.value === 'string' && field.value) {
      return { label: boundedText(field.value), labelTruncated: field.value.length > 256 };
    }
  }
  return { label: null, labelTruncated: false };
};
const selectorEvidence = value => {
  if (!value) return null;
  const normalized = selector(value);
  return { digest: architectureEvidenceHash(normalized), anyOf: normalized.anyOf.slice(0, 8).map(pattern => boundedText(pattern)),
    noneOf: normalized.noneOf.slice(0, 8).map(pattern => boundedText(pattern)),
    truncated: normalized.anyOf.length > 8 || normalized.noneOf.length > 8
      || [...normalized.anyOf.slice(0, 8), ...normalized.noneOf.slice(0, 8)].some(pattern => pattern.length > 256) };
};
export const architectureViolationEvidence = ({ rule, ruleIndex, policyDigest, edgeType, fromRef, toRef,
  fromNode, toNode, fromPath, toPath, index, layers = null }) => {
  const endpoint = (ref, node, path) => ({ ref: { ...ref }, path: typeof path === 'string' && path.length <= 32768 ? path : null,
    ...declarationLabel(node),
    availability: path && path.length <= 32768 ? 'source-path' : 'identity-only' });
  return { schemaVersion: 1, edgeId: architectureEdgeId(edgeType, fromRef, toRef),
    relation: edgeType, from: endpoint(fromRef, fromNode, fromPath), to: endpoint(toRef, toNode, toPath),
    index: { ...index }, policyDigest, ruleId: rule.id, ruleIndex,
    selectors: { from: selectorEvidence(rule.from), to: selectorEvidence(rule.to) },
    layers: layers ? { fromOrdinal: layers.from, toOrdinal: layers.to,
      fromName: boundedText(rule.layers[layers.from].name), toName: boundedText(rule.layers[layers.to].name),
      selection: 'first-match-in-policy-order' } : null,
    availability: 'observed-static-relationship', executionProven: false };
};

/** Shape validation precedes these cross-field checks. A retained witness must
 * describe this report's edge, policy rule and selected index, not another one.
 */
export const architectureEvidenceProjectionErrors = report => {
  const errors = [], retainedByRule = new Map();
  if (new Set(report.rules.map(rule => rule.id)).size !== report.rules.length) errors.push('Architecture report has duplicate rule identities.');
  if (report.rules.reduce((total, rule) => total + rule.summary.violations, 0) !== report.summary.detectedViolations) {
    errors.push('Architecture rule counts differ from total detected violations.');
  }
  if (report.summary && (report.summary.retainedViolations !== report.violations.length
    || report.summary.detectedViolations !== report.summary.retainedViolations + report.summary.omittedViolations)) {
    errors.push('Architecture violation accounting differs from retained evidence.');
  }
  for (const violation of report.violations) {
    const evidence = violation.evidence.details, edge = violation.edge;
    const rule = report.rules[evidence.ruleIndex];
    if (evidence.policyDigest !== report.policy.digest || evidence.ruleId !== violation.ruleId || rule?.id !== violation.ruleId) {
      errors.push('Architecture evidence policy/rule identity mismatch.');
    }
    if (evidence.relation !== edge.edgeType || evidence.edgeId !== architectureEdgeId(edge.edgeType, edge.from, edge.to)
      || evidence.edgeId !== architectureEdgeId(evidence.relation, evidence.from.ref, evidence.to.ref)) {
      errors.push('Architecture evidence endpoint/relation identity mismatch.');
    }
    if (['indexSignature', 'indexCompatKey', 'indexDir'].some(key => evidence.index[key] !== (report.provenance[key] || null))) {
      errors.push('Architecture evidence selected index differs from provenance.');
    }
    if (rule?.type === 'layering' && (!evidence.layers || evidence.layers.fromOrdinal >= evidence.layers.toOrdinal)
      || rule?.type !== 'layering' && evidence.layers !== null) errors.push('Architecture layer explanation differs from rule kind/order.');
    if (rule?.type === 'layering' ? evidence.selectors.from !== null || evidence.selectors.to !== null
      : evidence.selectors.from === null || evidence.selectors.to === null) errors.push('Architecture selector explanation differs from rule kind.');
    for (const endpoint of [evidence.from, evidence.to]) {
      if ((endpoint.path !== null) !== (endpoint.availability === 'source-path')
        || endpoint.ref.type === 'file' && endpoint.path !== null && endpoint.ref.path !== endpoint.path) {
        errors.push('Architecture endpoint source availability mismatch.');
      }
    }
    retainedByRule.set(violation.ruleId, (retainedByRule.get(violation.ruleId) || 0) + 1);
  }
  for (const rule of report.rules) if ((rule.summary?.violations || 0) < (retainedByRule.get(rule.id) || 0)) {
    errors.push('Architecture retained evidence exceeds the rule detection count.');
  }
  return errors;
};
