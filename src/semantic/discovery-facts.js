import { semanticHash } from '../index/semantic/identity.js';
import { normalizeTypeExpression } from '../retrieval/output/filters/type-expression.js';

export const DISCOVERY_INDEX_FIELDS = Object.freeze(['typeExpression', 'literalValue']);
export const typeExpressionKey = expression => semanticHash('semantic.exact-type-expression.v1', normalizeTypeExpression(expression));
export const literalValueKey = scalar => semanticHash('semantic.literal-scalar.v1', scalar);
export const discoveryIndexEntry = (record, ref) => record.kind === 'type' && typeof record.data.expression === 'string'
  ? { field: 'typeExpression', value: typeExpressionKey(record.data.expression), ref }
  : record.kind === 'literal' && record.data.scalar ? { field: 'literalValue', value: literalValueKey(record.data.scalar), ref } : null;

export const discoverySelector = selector => selector.typeExpression
  ? { field: 'typeExpression', value: typeExpressionKey(selector.typeExpression.expression) }
  : selector.literal ? { field: 'literalValue', value: literalValueKey(selector.literal) } : selector;

/** Hydrate and recheck the exact authority behind a derived lookup key. */
export const inspectDiscoveryFact = async ({ store, record, selector, signal, maxBytes }) => {
  const requested = selector.typeExpression;
  let source, role = null, owner = null;
  if (requested) {
    if (record.kind !== 'type' || typeof record.data.expression !== 'string'
      || typeExpressionKey(record.data.expression) !== typeExpressionKey(requested.expression)) {
      throw Object.assign(new Error('Type discovery index differs from its fact.'), { code: 'ERR_SEMANTIC_INTEGRITY' });
    }
    source = record.data.origin === 'declared' ? 'declared' : record.data.origin === 'checker-inferred' ? 'compiler' : null;
    if (!source) return null;
    if (!requested.sources.includes(source)) return null;
    owner = record.scope;
    if (!owner) throw Object.assign(new Error('Type fact has no recorded owner.'), { code: 'ERR_SEMANTIC_INTEGRITY' });
    const page = await store.getRelatedPage(owner, 'semantic_operands', { offset: 0, limit: 128, signal });
    const association = page.rows.find(row => row.child?.partitionId === record.ref.partitionId
      && row.child?.localId === record.ref.localId && row.slot.startsWith('ast:TypeFact.'));
    if (!association) {
      throw Object.assign(new Error(page.done ? 'Type fact owner association is absent.' : 'Type fact role exceeds association allowance.'), {
        code: page.done ? 'ERR_SEMANTIC_INTEGRITY' : 'ERR_SEMANTIC_OUTPUT_LIMIT'
      });
    }
    role = association.slot.slice('ast:TypeFact.'.length);
    if (!requested.roles.includes(role)) return null;
  } else {
    if (record.kind !== 'literal' || !record.data.scalar || literalValueKey(record.data.scalar) !== literalValueKey(selector.literal)) {
      throw Object.assign(new Error('Literal discovery index differs from its scalar.'), { code: 'ERR_SEMANTIC_INTEGRITY' });
    }
    source = 'literal';
  }
  const [span] = await store.getSourceSpans([record.ref], { signal, maxBytes });
  if (!span) throw Object.assign(new Error('Discovery fact has no retained source span.'), { code: 'ERR_SEMANTIC_INTEGRITY' });
  return { kind: requested ? 'type' : 'literal', source, role, owner,
    sourceUnitId: span.sourceUnitId, sourceHash: span.sourceHash,
    expression: requested ? record.data.expression : null,
    scalar: requested ? null : record.data.scalar,
    compilerContextKey: requested ? record.data.compilerContextKey : null };
};
