import { isDeepStrictEqual } from 'node:util';
import { FLOW_FIELDS, admitFlowEvidence, copyFlowValue, createFlowEvidence, flowSourceIdentity,
  hasFlowValue, sealFlowEvidence } from '../../../shared/flow-evidence.js';

const ranks = { none: 0, legacy: 1, syntax: 2, semantic: 3 };
const ownedValues = input => Object.fromEntries(FLOW_FIELDS.filter(field => hasFlowValue(input, field)).map(field => [field, copyFlowValue(input[field])]));

/** This owner never mutates an adapter's shared/frozen metadata. Different
 * source/owner/scope evidence cannot be silently combined or unioned. */
export const mergeQualifiedFlowMeta = (docmeta, flowMeta, options = {}) => {
  const original = docmeta && typeof docmeta === 'object' && !Array.isArray(docmeta) ? docmeta : {};
  const incoming = flowMeta && typeof flowMeta === 'object' && !Array.isArray(flowMeta) ? flowMeta : {};
  const output = { ...original, ...ownedValues(original) };
  const suppliedSource = typeof options.text === 'string' ? flowSourceIdentity(options) : null;
  const source = suppliedSource || original.flowEvidence?.source || incoming.flowEvidence?.source || flowSourceIdentity();
  const prior = original.flowEvidence ? admitFlowEvidence(original.flowEvidence, original, { source })
    : createFlowEvidence({ values: original, source, producer: { id: 'legacy-docmeta', version: 'unqualified' } });
  const next = incoming.flowEvidence ? admitFlowEvidence(incoming.flowEvidence, incoming, { source })
    : createFlowEvidence({ values: incoming, source, producer: { id: options.producerId || 'legacy-flow', version: 'unqualified' } });
  const fields = Object.fromEntries(FLOW_FIELDS.map(field => [field, structuredClone(prior.fields[field])]));
  const diagnostics = [...prior.diagnostics.map(value => ({ ...value }))];
  let omittedDiagnostics = prior.omittedDiagnostics + (prior.identity === next.identity ? 0 : next.omittedDiagnostics);
  for (const item of next.diagnostics) if (!diagnostics.some(value => isDeepStrictEqual(value, item))) {
    if (diagnostics.length < 16) diagnostics.push({ ...item }); else omittedDiagnostics++;
  }
  const diagnostic = (field, code, kept, rejected) => {
    const item = { field, code, keptProducer: kept.producer.id, rejectedProducer: rejected.producer.id };
    if (diagnostics.some(value => isDeepStrictEqual(value, item))) return;
    if (diagnostics.length < 16) diagnostics.push(item); else omittedDiagnostics++;
  };
  for (const field of FLOW_FIELDS) {
    const enabled = field === 'controlFlow' ? options.controlFlowEnabled : options.astDataflowEnabled;
    const old = fields[field], candidate = next.fields[field];
    if (enabled === false) {
      delete output[field];
      fields[field] = { ...old, state: 'disabled', authority: 'none', valueHash: null, reasons: ['analysis_disabled'] };
      continue;
    }
    if (!hasFlowValue(incoming, field)) {
      if (!hasFlowValue(output, field) && candidate.state !== 'unknown') fields[field] = structuredClone(candidate);
      continue;
    }
    if (!hasFlowValue(output, field)) {
      output[field] = copyFlowValue(incoming[field]); fields[field] = structuredClone(candidate); continue;
    }
    // Syntactic effects cannot displace semantic effects just by having a newer
    // value. Different scopes/fact kinds remain separate observations.
    const sameKind = old.kind === candidate.kind;
    const compatibleScope = old.authority === 'legacy' || candidate.authority === 'legacy' || old.scope === candidate.scope;
    if (!sameKind || !compatibleScope) { diagnostic(field, 'incomparable_scope_or_fact_kind', old, candidate); continue; }
    if (ranks[candidate.authority] > ranks[old.authority]) {
      output[field] = copyFlowValue(incoming[field]); fields[field] = structuredClone(candidate);
    } else if (!isDeepStrictEqual(output[field], incoming[field])) {
      diagnostic(field, ranks[candidate.authority] < ranks[old.authority] ? 'lower_authority_ignored' : 'equal_authority_conflict', old, candidate);
      if (ranks[candidate.authority] === ranks[old.authority]) fields[field] = { ...old, state: 'conflict' };
    }
  }
  output.flowEvidence = sealFlowEvidence({ source, fields, diagnostics, omittedDiagnostics });
  admitFlowEvidence(output.flowEvidence, output, { source });
  return output;
};
