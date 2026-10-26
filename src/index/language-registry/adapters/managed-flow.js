import { FLOW_FIELDS, admitFlowEvidence, copyFlowValue, createFlowEvidence, flowSourceIdentity, sealFlowEvidence } from '../../../shared/flow-evidence.js';

/** Projection consumes an owned compact native product. The lexical fallback
 * has no semantic fact authority, including for literal template output. */
export const buildManagedFlow = ({ text, chunk, languageId, context, options = {} }) => {
  if (!chunk || !Number.isSafeInteger(chunk.start) || !Number.isSafeInteger(chunk.end)) return null;
  const source = flowSourceIdentity({ text, chunk, languageId, context });
  const product = chunk.meta?.syntaxFlow;
  const base = product?.flowEvidence ? admitFlowEvidence(product.flowEvidence, product, { source })
    : createFlowEvidence({ source, producer: { id: 'managed-flow:' + languageId, version: '1' },
      scope: 'no-qualified-managed-flow-owner', states: Object.fromEntries(FLOW_FIELDS.map(field => [field, 'unavailable'])), reasons: ['qualified_flow_owner_unavailable'] });
  const values = {}, fields = {};
  for (const field of FLOW_FIELDS) {
    const disabled = field === 'controlFlow' ? options.controlFlow === false : options.dataflow === false;
    fields[field] = disabled ? { ...base.fields[field], state: 'disabled', authority: 'none', valueHash: null, reasons: ['analysis_disabled'] }
      : structuredClone(base.fields[field]);
    if (!disabled && product?.[field] != null) values[field] = copyFlowValue(product[field]);
  }
  return { ...values, flowEvidence: sealFlowEvidence({ source, fields, diagnostics: base.diagnostics, omittedDiagnostics: base.omittedDiagnostics }) };
};
