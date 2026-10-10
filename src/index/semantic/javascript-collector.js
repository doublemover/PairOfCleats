import { createRequire } from 'node:module';
import { VISITOR_KEYS } from '@babel/types';
import { canonicalSemanticJson } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';

export const JAVASCRIPT_ADAPTER_VERSION = '1:' + createRequire(import.meta.url)('@babel/types/package.json').version;
const KEYS = Object.freeze({ ...VISITOR_KEYS,
  Literal: [], Property: ['key', 'value'], ChainExpression: ['expression'],
  ImportExpression: ['source', 'options'], MethodDefinition: ['key', 'value']
});
const SCOPES = new Set(['Program', 'BlockStatement', 'CatchClause', 'ClassDeclaration', 'ClassExpression',
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod']);
const invocation = (type) => ({ CallExpression: 'call', OptionalCallExpression: 'optionalCall',
  NewExpression: 'construct', TaggedTemplateExpression: 'tag', ImportExpression: 'import' })[type] || null;
const isLiteral = (type) => /Literal$/.test(type) || type === 'TemplateElement';
const isStatement = (type) => /Statement$/.test(type) || /Declaration$/.test(type) || type === 'Program';
const flagList = (node) => ['async', 'generator', 'optional', 'computed', 'static', 'shorthand', 'prefix']
  .filter((key) => node[key] === true);
const roles = (node, parent, field, binding) => {
  if (binding) return ['definition'];
  if (field === 'id' || field === 'params' || (parent?.type === 'CatchClause' && field === 'param')) return ['definition'];
  if (parent?.type?.startsWith('Import')) return ['import', 'definition'];
  if ((field === 'property' || field === 'key') && !parent?.computed) return ['property'];
  if (field === 'callee') return [parent?.type === 'NewExpression' ? 'construct' : 'call', 'reference'];
  if (field === 'left' && parent?.type === 'AssignmentExpression') return ['write', 'reference'];
  if (parent?.type === 'UpdateExpression') return ['read', 'write', 'reference'];
  return ['read', 'reference'];
};
const childSlot = (node, field) => {
  const common = { tag: 'callee', callee: 'callee', arguments: 'argument', params: 'parameter', left: 'left', right: 'right',
    object: 'object', test: 'condition', init: 'initializer', elements: 'element' };
  if (common[field]) return common[field];
  if (field === 'property' && node.computed) return 'index';
  if (field === 'key' && /Property|Method/.test(node.type)) return 'propertyKey';
  if (field === 'value' && /Property/.test(node.type)) return 'propertyValue';
  if (field === 'consequent' && node.type === 'ConditionalExpression') return 'trueValue';
  if (field === 'alternate' && node.type === 'ConditionalExpression') return 'falseValue';
  if (field === 'argument') return ({ ReturnStatement: 'returnValue', ThrowStatement: 'throwValue',
    AwaitExpression: 'awaitValue', YieldExpression: 'yieldValue' })[node.type] || `ast:${node.type}.${field}`;
  if (field === 'body') return 'body';
  return `ast:${node.type}.${field}`;
};
export const JAVASCRIPT_STRUCTURAL_SLOTS = Object.freeze(Object.entries(KEYS)
  .flatMap(([kind, keys]) => keys.map((field) => `ast:${kind}.${field}`)).sort());

/** One explicit-stack traversal. Advancing the iterator is the producer admission boundary. */
export const createSemanticCollector = ({ ast, source, partitionId, unavailable = null, signal = null }, policy = {}) => {
  const batchRows = policy.batchRows ?? 4096;
  const batchBytes = policy.batchBytes ?? 1048576;
  if (!Number.isSafeInteger(batchRows) || batchRows < 1 || !Number.isSafeInteger(batchBytes) || batchBytes < 1) {
    throw new TypeError('Positive semantic batch limits required.');
  }
  const summary = { nodes: 0, operands: 0, calls: 0, unsupported: 0, state: 'partial' };
  const ref = (localId) => ({ partitionId, localId });
  const names = new Map();
  let nextId = 0;
  const rows = function* () {
    if (!ast) {
      yield { family: 'coverage', row: { scope: { sourceUnitId: source.sourceUnitId }, phase: 'syntax',
        state: unavailable?.state || 'failed', reason: unavailable?.reason || 'parser_unavailable', observedCount: null, completedCount: 0, frontierRef: null } };
      return;
    }
    const stack = [{ node: ast, scope: null, parent: null, field: null, ordinal: 0, entered: false }];
    while (stack.length) {
      throwIfAborted(signal);
      const frame = stack[stack.length - 1];
      const { node } = frame;
      if (!frame.entered) {
        frame.entered = true;
        frame.keys = KEYS[node.type] || [];
        frame.keyIndex = 0;
        frame.childIndex = 0;
        if (!Object.hasOwn(KEYS, node.type)) summary.unsupported += 1;
        const span = Number.isSafeInteger(node.start) && Number.isSafeInteger(node.end)
          ? [node.start, node.end] : Array.isArray(node.range) ? [...node.range] : null;
        const kinds = [];
        const identifier = node.type === 'Identifier' || node.type === 'PrivateName';
        if (SCOPES.has(node.type)) kinds.push('scope');
        const occurrenceRoles = identifier ? roles(node, frame.parent?.node, frame.field, frame.binding) : null;
        if (occurrenceRoles?.includes('definition')) kinds.push('declaration');
        if (identifier) kinds.push('occurrence');
        if (isStatement(node.type)) kinds.push('statement');
        kinds.push('expression');
        if (isLiteral(node.type)) kinds.push('literal');
        const ids = Object.fromEntries(kinds.map((kind) => [kind, nextId++]));
        frame.record = ref(ids.expression);
        const parentScope = frame.scope;
        if (ids.scope !== undefined) frame.scope = ref(ids.scope);
        let nameId = null;
        if (identifier) {
          const name = node.name || node.id?.name || '';
          if (!names.has(name)) {
            nameId = names.size;
            names.set(name, nameId);
            yield { family: 'lookup', row: { kind: 'name', id: nameId, value: name } };
          } else nameId = names.get(name);
        }
        const kind = invocation(node.type);
        if (kind) summary.calls += 1;
        for (const recordKind of kinds) {
          const payload = {
            scope: () => ({ scopeKind: node.type, parent: parentScope, owner: frame.record }),
            declaration: () => ({ nameId, declarationKind: frame.parent?.node.type || node.type,
              flags: [], initializer: null, typeSyntax: null }),
            occurrence: () => ({ nameId, roles: occurrenceRoles, expression: frame.record, flags: [] }),
            statement: () => ({ astKind: node.type, statementKind: node.type, flags: flagList(node) }),
            expression: () => ({ astKind: node.type, operation: node.operator || null,
              invocationKind: kind, syntacticArgumentCount: kind ? (node.arguments?.length
                ?? node.quasi?.expressions?.length ?? (kind === 'import' ? 1 : 0)) : null, flags: flagList(node) }),
            literal: () => ({ literalKind: node.type, textRef: { span }, scalar: null })
          }[recordKind]();
          summary.nodes += 1;
          yield { family: 'node', row: { id: ids[recordKind], kind: recordKind, span,
            scope: recordKind === 'scope' ? parentScope : frame.scope, data: payload } };
        }
        if (frame.field === 'object' && /MemberExpression$/.test(frame.parent?.node.type)
          && frame.parent.field === 'callee' && frame.parent.parent) {
          summary.operands += 1;
          yield { family: 'operand', row: { parent: frame.parent.parent.record, slot: 'receiver', ordinal: 0,
            child: frame.record, flags: [] } };
        }
        if (frame.parent) {
          summary.operands += 1;
          yield { family: 'operand', row: { parent: frame.parent.record,
            slot: childSlot(frame.parent.node, frame.field), ordinal: frame.ordinal,
            child: frame.record, flags: [
              ...(/Spread/.test(node.type) ? ['spread'] : []),
              ...(node.type === 'RestElement' ? ['rest'] : []),
              ...(frame.parent.node.computed ? ['computed'] : []),
              ...(frame.parent.node.shorthand ? ['shorthand'] : [])
            ] } };
        }
      }
      if (frame.keyIndex >= frame.keys.length) { stack.pop(); continue; }
      const field = frame.keys[frame.keyIndex];
      const children = node[field];
      const list = Array.isArray(children);
      if (frame.childIndex >= (list ? children.length : 1)) {
        frame.keyIndex += 1; frame.childIndex = 0; continue;
      }
      const ordinal = frame.childIndex++;
      const child = list ? children[ordinal] : children;
      if (!child) {
        if (field === 'elements' && list) {
          summary.operands += 1;
          yield { family: 'operand', row: { parent: frame.record, slot: 'element', ordinal, child: null, flags: ['hole'] } };
        }
        continue;
      }
      if (typeof child.type !== 'string') continue;
      const binding = (field === 'id' || field === 'params' || (node.type === 'CatchClause' && field === 'param'))
        || (node.type.startsWith('Import') && field === 'local')
        || (node.type === 'ObjectPattern' && field === 'properties')
        || (node.type === 'ArrayPattern' && field === 'elements')
        || (frame.binding && ((node.type === 'ObjectProperty' && field === 'value')
          || (node.type === 'AssignmentPattern' && field === 'left') || (node.type === 'RestElement' && field === 'argument')));
      stack.push({ node: child, scope: frame.scope, parent: frame, field, ordinal, binding, entered: false });
    }
    summary.state = summary.unsupported || ast.errors?.length ? 'partial' : 'complete';
    yield { family: 'coverage', row: { scope: { sourceUnitId: source.sourceUnitId }, phase: 'syntax',
      state: summary.state, reason: summary.state === 'complete' ? null : 'unsupported_or_recovered_syntax',
      observedCount: summary.nodes, completedCount: summary.nodes, frontierRef: null } };
    for (const phase of ['bindings', 'localFlow', 'crossFileFlow', 'boundaryModels']) {
      yield { family: 'coverage', row: { scope: { sourceUnitId: source.sourceUnitId }, phase,
        state: 'unsupported', reason: 'analysis_implementation_pending', observedCount: null, completedCount: 0, frontierRef: null } };
    }
  };
  const batches = function* () {
    let batch = [];
    let byteCount = 0;
    let sequence = 0;
    for (const entry of rows()) {
      const bytes = Buffer.byteLength(canonicalSemanticJson(entry)) + 1;
      if (bytes > batchBytes) throw Object.assign(new Error('Semantic record exceeds producer batch allowance.'),
        { code: 'ERR_SEMANTIC_RECORD_LIMIT' });
      if (batch.length && (batch.length >= batchRows || byteCount + bytes > batchBytes)) {
        yield { partitionId, sequence: sequence++, rows: batch, byteCount };
        batch = []; byteCount = 0;
      }
      batch.push(entry); byteCount += bytes;
    }
    if (batch.length) yield { partitionId, sequence, rows: batch, byteCount };
  };
  return { batches: batches(), summary, structuralSlots: JAVASCRIPT_STRUCTURAL_SLOTS };
};
