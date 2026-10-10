import { createAnalysisPartitionId, semanticHash, canonicalSemanticJson } from './identity.js';
import { writeSemanticAnalysis } from './analysis-write.js';
import { throwIfAborted } from '../../shared/abort.js';

/** Allocation/field candidates remain separate from ordered local reaching definitions. */
export const collectCompilerStorageFlow = async ({ ts, checker, sourceFile, nodes, expressionFor,
  source, bytes, bindingPartition, context, root, policy, diskAccount, signal }) => {
  if (['off', 'deferred'].includes(policy.enrichment.localFlow)) return null;
  const partitionId = createAnalysisPartitionId({ pass: { name: 'compiler-storage-flow', version: '1' },
    inputPartitionHashes: [bindingPartition.canonicalHash], compilerContext: context, dependencySummaryHashes: [],
    analysisPolicy: { fieldPathDepth: policy.enrichment.fieldPathDepth } });
  const ledger = new Map(), edges = [], reasons = new Set(), fields = new Map(), resolved = new WeakMap();
  const local = key => ({ local: key });
  const add = (key, kind, node, data) => {
    if (!ledger.has(key)) ledger.set(key, { kind, span: node ? [node.getStart(sourceFile), node.end] : null, scope: null, data });
    return local(key);
  };
  const evidence = add('evidence', 'evidence', null, { method: 'allocation-field-candidates', producerId: 'semantic-storage',
    producerVersion: '1', evidenceKind: 'static-analysis', sourceRef: source.sourceUnitId, artifactRef: null });
  const edge = (kind, from, to) => {
    if (from && to) edges.push({ kind, from, to, callSite: null, operandOrdinal: null, contextKey: context.contextKey,
      condition: null, evidence, certainty: 'modeled' });
  };
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)
      || ts.isTypeAssertionExpression(node))) node = node.expression;
    return node;
  };
  const propertyName = node => {
    if (!node) return null;
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
    if (ts.isComputedPropertyName(node)) return ts.isStringLiteralLike(node.expression) || ts.isNumericLiteral(node.expression) ? node.expression.text : null;
    return null;
  };
  const resolve = (input, depth = 0, seen = new Set()) => {
    const node = unwrap(input);
    if (!node || seen.has(node)) { if (node) reasons.add('cyclic_storage_alias'); return null; }
    if (resolved.get(node)?.has(depth)) return resolved.get(node).get(depth);
    const remember = value => {
      if (!resolved.has(node)) resolved.set(node, new Map());
      resolved.get(node).set(depth, value); return value;
    };
    const next = new Set(seen); next.add(node);
    if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) return node;
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const declaration = symbol?.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration) && (declaration.parent.flags & ts.NodeFlags.Const)) {
        return remember(resolve(declaration.initializer, depth, next));
      }
      return null;
    }
    const access = locate(node, depth, next);
    return remember(access?.initializer ? resolve(access.initializer, depth + 1, next) : null);
  };
  const locate = (node, depth = 0, seen = new Set()) => {
    if (!node || !(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) return null;
    if (depth >= policy.enrichment.fieldPathDepth) { reasons.add('field_path_depth_widened'); return null; }
    const key = ts.isPropertyAccessExpression(node) ? propertyName(node.name)
      : ts.isStringLiteralLike(node.argumentExpression) || ts.isNumericLiteral(node.argumentExpression) ? node.argumentExpression.text : null;
    if (key === null) { reasons.add('dynamic_property_key'); return null; }
    const allocation = resolve(node.expression, depth + 1, seen);
    if (!allocation) { reasons.add('allocation_or_alias_unresolved'); return null; }
    let initializer = null;
    if (ts.isArrayLiteralExpression(allocation)) {
      if (allocation.elements.some(element => ts.isSpreadElement(element))) { reasons.add('array_spread_index_unknown'); return null; }
      if (/^(0|[1-9][0-9]*)$/.test(key)) initializer = allocation.elements[Number(key)];
      if (initializer && ts.isOmittedExpression(initializer)) initializer = null;
    } else {
      if (allocation.properties.some(property => ts.isSpreadAssignment(property) || propertyName(property.name) === null)) {
        reasons.add('spread_or_computed_field_override_unknown'); return null;
      }
      const property = [...allocation.properties].reverse().find(property => propertyName(property.name) === key);
      if (property && ts.isPropertyAssignment(property)) initializer = property.initializer;
      else if (property && ts.isShorthandPropertyAssignment(property)) initializer = property.name;
      else if (property) { reasons.add('getter_setter_or_method_effect_unknown'); return null; }
    }
    return { allocation, key, initializer };
  };
  let accesses = 0;
  for (const node of nodes) {
    throwIfAborted(signal);
    if (!(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) continue;
    accesses += 1;
    const access = locate(node);
    if (!access) continue;
    const site = expressionFor(access.allocation);
    if (!site) { reasons.add('missing_allocation_source_anchor'); continue; }
    const allocationKey = canonicalSemanticJson(site);
    const storage = add('allocation:' + allocationKey, 'value', access.allocation, { origin: 'heap', site, storage: null });
    const fieldKey = allocationKey + ':' + JSON.stringify(access.key);
    const field = add('field:' + fieldKey, 'value', node, { origin: 'heap', site: expressionFor(node), storage });
    if (!fields.has(fieldKey)) {
      fields.set(fieldKey, field);
      edge('defines', site, storage);
      edge('packs', expressionFor(access.initializer), field);
      if (!access.initializer) reasons.add('field_initial_value_unknown');
    }
    const parent = node.parent;
    const assignment = ts.isBinaryExpression(parent) && parent.left === node
      && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
    if (assignment) {
      edge('writes', expressionFor(parent.right), field);
      edge('mutates', expressionFor(parent), storage);
      if (parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken) edge('reads', field, expressionFor(node));
      reasons.add('field_write_order_and_alias_effects_conservative');
    } else {
      edge('reads', field, expressionFor(node));
      if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
        && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator)) {
        edge('writes', expressionFor(parent), field); reasons.add('field_write_order_and_alias_effects_conservative');
      }
    }
  }
  if (fields.size) reasons.add('field_alias_escape_and_effect_order_unresolved');
  const keys = [...ledger.keys()].sort(), ids = new Map(keys.map((key, id) => [key, id]));
  const expand = value => {
    if (!value || typeof value !== 'object') return value;
    if (Object.hasOwn(value, 'local')) return { partitionId, localId: ids.get(value.local) };
    if (Array.isArray(value)) return value.map(expand);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]));
  };
  const rows = keys.map(key => ({ family: 'node', row: { id: ids.get(key), ...expand(ledger.get(key)) } }));
  const unique = [...new Map(edges.map(edge => { const row = expand(edge); return [canonicalSemanticJson(row), row]; })).entries()].sort(([a], [b]) => a.localeCompare(b));
  unique.forEach(([, row], id) => rows.push({ family: 'edge', row: { id, ...row } }));
  const coverage = { scope: { sourceUnitId: source.sourceUnitId }, phase: 'localFlow', state: reasons.size ? 'partial' : 'complete',
    reason: reasons.size ? [...reasons].sort().join(';') : null, observedCount: accesses, completedCount: fields.size, frontierRef: null };
  rows.push({ family: 'coverage', row: coverage });
  const partition = await writeSemanticAnalysis({ rows, policy, stagingRoot: root, source, sourceBytes: bytes, partitionId,
    producerHash: semanticHash('semantic.storage-producer.v1', { version: 1 }), contextHash: context.contextKey,
    policyHash: semanticHash('semantic.storage-policy.v1', { fieldPathDepth: policy.enrichment.fieldPathDepth }), diskAccount, signal });
  return { partition, coverage: [coverage] };
};
