import { resolveJavaScriptDeclaration, JAVASCRIPT_RELATIONS_VERSION } from './callable-occurrences.js';
import { FLOW_FIELDS, createFlowEvidence, flowSourceIdentity, flowValueEmpty } from '../../shared/flow-evidence.js';
import { rebaseJavaScriptParameterFacts } from './source-projection.js';
import { readEmbeddedContent, projectEmbeddedContentEnvelope } from '../../shared/embedded-content.js';

export const projectJavaScriptDeclaration = (text, chunk, relations, analysis = relations?.jsDeclarations?.analysis || {}, sourceView = null) => {
  const join = resolveJavaScriptDeclaration(text, chunk, relations?.jsDeclarations);
  const record = join.record, original = record?.metadata || {};
  const metadata = { ...original }, values = {}, states = {};
  const reasons = join.reason ? [join.reason] : [];
  const complete = join.exact && record?.scopeState === 'complete';
  for (const field of FLOW_FIELDS) {
    const value = original[field];
    const disabled = field === 'controlFlow' ? analysis.controlFlow === false : analysis.dataflow === false;
    if (disabled) { delete metadata[field]; states[field] = 'disabled'; }
    else if (!join.exact || !record || value == null || !complete && flowValueEmpty(value)) {
      delete metadata[field]; states[field] = 'unavailable';
    } else {
      values[field] = value;
      states[field] = complete && ['returnsValue', 'yields'].includes(field)
        ? flowValueEmpty(value) ? 'produced-empty' : 'produced-positive' : 'partial';
    }
  }
  if (record && !complete) reasons.push(record.kind === 'callable' ? 'callable_projection_or_traversal_incomplete' : 'non_callable_declaration_has_no_invocation_flow');
  if (!record) reasons.push('source_owned_callable_unavailable');
  const mappedRange = sourceView?.contentView ? projectEmbeddedContentEnvelope(sourceView.contentView, chunk) : null;
  if (sourceView && ((sourceView.contentView ? readEmbeddedContent(sourceView.text, sourceView.contentView)
    : sourceView.text.slice(sourceView.offset, sourceView.offset + text.length)) !== text
    || sourceView.chunk.start !== (mappedRange?.start ?? chunk.start + sourceView.offset)
    || sourceView.chunk.end !== (mappedRange?.end ?? chunk.end + sourceView.offset))) {
    throw Object.assign(new Error('JavaScript segment does not match its container source mapping.'), { code: 'ERR_JS_DECLARATION_OCCURRENCE' });
  }
  const source = flowSourceIdentity({ text: sourceView?.text || text, chunk: sourceView?.chunk || chunk, languageId: 'javascript', context: relations?.jsDeclarations });
  const flowEvidence = createFlowEvidence({ values, source, producer: { id: 'javascript-declaration-flow', version: JAVASCRIPT_RELATIONS_VERSION },
    authority: 'syntax', scope: 'javascript-owned-invocation-syntax', states,
    reasons: [...reasons, 'syntax_identifier_effects_not_runtime_dataflow'] });
  const javascriptDeclaration = { schemaVersion: 1, state: join.state, reason: join.reason, occurrenceId: record?.id || null,
    role: record?.role || null, ownerRange: record?.range || null, projectionRange: { start: sourceView?.chunk.start ?? chunk.start, end: sourceView?.chunk.end ?? chunk.end },
    sourceHash: relations?.jsDeclarations?.source.textHash || null, internalName: record?.internalName || null,
    sourceMapping: sourceView?.contentView ? { schemaVersion: 2, contentView: sourceView.contentView }
      : { offset: sourceView?.offset || 0, length: text.length }, parentId: record?.parentId || null };
  return { join, metadata: rebaseJavaScriptParameterFacts(metadata, sourceView?.contentView || sourceView?.offset || 0), flowEvidence, javascriptDeclaration };
};
