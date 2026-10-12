import { createHash } from 'node:crypto';
import { canonicalSemanticJson } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { getTypeScriptSyntaxIdentity } from '../../lang/typescript/syntax-context.js';
import { TYPESCRIPT_CHILD_FIELDS, TYPESCRIPT_STRUCTURAL_SLOTS,
  typeScriptKindName } from '../../lang/typescript/syntax-adapter.js';

export const TYPESCRIPT_ADAPTER_VERSION = '3';
const scopeKinds = new Set('SourceFile Block CatchClause ClassDeclaration ClassExpression InterfaceDeclaration ModuleDeclaration FunctionDeclaration FunctionExpression ArrowFunction MethodDeclaration Constructor GetAccessor SetAccessor ClassStaticBlockDeclaration'.split(' '));
const declarationParents = new Set('VariableDeclaration Parameter BindingElement FunctionDeclaration FunctionExpression ClassDeclaration ClassExpression InterfaceDeclaration TypeAliasDeclaration EnumDeclaration EnumMember ModuleDeclaration TypeParameter ImportClause ImportSpecifier NamespaceImport ImportEqualsDeclaration'.split(' '));
const slotFor = (kind, field) => {
  const common = { arguments: 'argument', parameters: 'parameter', typeArguments: 'typeArgument',
    left: 'left', right: 'right', condition: 'condition', whenTrue: 'trueValue', whenFalse: 'falseValue',
    initializer: 'initializer', body: 'body', elements: 'element', tag: 'callee', argumentExpression: 'index' };
  if (kind === 'PropertyAssignment' && field === 'initializer') return 'propertyValue';
  if (common[field]) return common[field];
  if (field === 'expression') return ({ CallExpression: 'callee', NewExpression: 'callee',
    PropertyAccessExpression: 'object', ElementAccessExpression: 'object', ReturnStatement: 'returnValue',
    ThrowStatement: 'throwValue', AwaitExpression: 'awaitValue', YieldExpression: 'yieldValue' })[kind] || `ast:${kind}.${field}`;
  if (kind === 'PropertyAssignment' && field === 'name') return 'propertyKey';
  if (kind === 'PropertyAssignment' && field === 'initializer') return 'propertyValue';
  return `ast:${kind}.${field}`;
};
const rolesFor = (frame) => {
  if (frame.binding) return ['definition'];
  if (frame.targetRoles) return frame.targetRoles;
  const kind = frame.parent?.kind;
  const field = frame.field;
  if (field === 'name' && declarationParents.has(kind)) return kind.startsWith('Import') || kind === 'NamespaceImport'
    ? ['import', 'definition'] : ['definition'];
  if (kind === 'ImportSpecifier' && field === 'propertyName') return ['import', 'reference'];
  if (kind === 'ExportSpecifier') return field === 'name' && frame.parent.node.propertyName
    ? ['export', 'property'] : ['export', 'reference'];
  if (field === 'name' && /Method|Accessor/.test(kind || '')) return ['definition', 'property'];
  if (field === 'propertyName' || (field === 'name' && /Property|Method|Accessor/.test(kind || ''))) return ['property'];
  if (field === 'tag' && kind === 'TaggedTemplateExpression') return ['call', 'reference'];
  if (field === 'expression' && (kind === 'CallExpression' || kind === 'NewExpression')) return [kind === 'NewExpression' ? 'construct' : 'call', 'reference'];
  if (kind === 'BinaryExpression' && field === 'left' && frame.parent.operation?.endsWith('=')) {
    const op = frame.parent.operation;
    if (!['==', '===', '!=', '!==', '<=', '>='].includes(op)) return op === '=' ? ['write', 'reference'] : ['read', 'write', 'reference'];
  }
  if (['PrefixUnaryExpression', 'PostfixUnaryExpression'].includes(kind) && ['++', '--'].includes(frame.parent.operation)) return ['read', 'write', 'reference'];
  return ['read', 'reference'];
};

/** Resumable preorder producer. The consumer awaits a sink before requesting another batch. */
export const createTypeScriptSemanticCollector = ({ ast, ts, source, partitionId, unavailable = null, signal = null }, policy = {}) => {
  const batchRows = policy.batchRows ?? 4096;
  const batchBytes = policy.batchBytes ?? 1048576;
  if (!Number.isSafeInteger(batchRows) || batchRows < 1 || !Number.isSafeInteger(batchBytes) || batchBytes < 1) throw new TypeError('Positive semantic batch limits required.');
  if (ast && (!ts || !getTypeScriptSyntaxIdentity(ast))) throw new TypeError('An owned TypeScript SourceFile and its compiler module are required.');
  if (ast && (ast.text.length !== source.textLength || createHash('sha256').update(ast.text, 'utf8').digest('hex') !== source.textHash)) throw new TypeError('TypeScript source length mismatch.');
  const summary = { nodes: 0, operands: 0, calls: 0, unsupported: 0, state: 'partial' };
  const unsupportedKinds = new Set();
  const ref = (localId) => ({ partitionId, localId });
  const names = new Map();
  let nextId = 0;
  const coverage = (phase, state, reason, observedCount = null, completedCount = 0) => ({ family: 'coverage', row: {
    scope: { sourceUnitId: source.sourceUnitId }, phase, state, reason, observedCount, completedCount, frontierRef: null
  } });
  function* rows() {
    if (!ast) {
      summary.state = unavailable?.state || 'unsupported';
      yield coverage('syntax', summary.state, unavailable?.reason || 'parser_unavailable');
    } else {
      const stack = [{ node: ast, scope: null, parent: null, field: null, ordinal: 0, entered: false }];
      while (stack.length) {
        throwIfAborted(signal);
        const frame = stack[stack.length - 1];
        const { node } = frame;
        if (!frame.entered) {
          frame.entered = true;
          const kind = typeScriptKindName(ts, node);
          frame.kind = kind;
          frame.keys = TYPESCRIPT_CHILD_FIELDS[kind] || [];
          frame.keyIndex = 0; frame.childIndex = 0;
          // Compiler tokens are intentional leaves. Unknown composite syntax is partial coverage.
          if (!Object.hasOwn(TYPESCRIPT_CHILD_FIELDS, kind) && node.kind > ts.SyntaxKind.LastToken
            && !['OmittedExpression', 'JsxText', 'JsxOpeningFragment', 'JsxClosingFragment'].includes(kind)) {
            summary.unsupported += 1; unsupportedKinds.add(kind);
          }
          const start = kind === 'SourceFile' ? 0 : node.getStart(ast, false);
          const span = [start, node.end];
          if (!Number.isSafeInteger(start) || start < 0 || node.end < start || node.end > source.textLength) throw new TypeError('Invalid TypeScript source span.');
          const identifier = kind === 'Identifier' || kind === 'PrivateIdentifier';
          const invocationKind = kind === 'CallExpression' ? (node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? 'import' : ts.isCallChain(node) ? 'optionalCall' : 'call') : kind === 'NewExpression'
            ? 'construct' : kind === 'TaggedTemplateExpression' ? 'tag' : null;
          frame.operation = node.operatorToken ? ts.tokenToString(node.operatorToken.kind)
            : typeof node.operator === 'number' ? ts.tokenToString(node.operator) : null;
          const roles = identifier ? rolesFor(frame) : null;
          const kinds = [];
          if (scopeKinds.has(kind)) kinds.push('scope');
          if (roles?.includes('definition')) kinds.push('declaration');
          if (identifier) kinds.push('occurrence');
          if (/Statement$|Declaration$/.test(kind) || kind === 'SourceFile') kinds.push('statement');
          kinds.push('expression');
          if (/Literal$|^Template(Head|Middle|Tail)$/.test(kind) || ['TrueKeyword', 'FalseKeyword', 'NullKeyword'].includes(kind)) kinds.push('literal');
          const ids = Object.fromEntries(kinds.map((recordKind) => [recordKind, nextId++]));
          frame.record = ref(ids.expression);
          const parentScope = frame.scope;
          if (ids.scope !== undefined) frame.scope = ref(ids.scope);
          let nameId = null;
          if (identifier) {
            const name = String(node.text ?? node.escapedText);
            if (!names.has(name)) {
              nameId = names.size; names.set(name, nameId);
              yield { family: 'lookup', row: { kind: 'name', id: nameId, value: name } };
            } else nameId = names.get(name);
          }
          const flags = [];
          if (node.questionDotToken || ts.isCallChain(node) || ts.isPropertyAccessChain(node) || ts.isElementAccessChain(node)) flags.push('optional');
          if (node.dotDotDotToken) flags.push('rest');
          if (node.asteriskToken) flags.push('generator');
          if (node.isTypeOnly || frame.typeOnly || ts.isTypeNode(node)) flags.push('typeOnly');
          if (unsupportedKinds.has(kind)) flags.push('unsupportedSyntax');
          if (invocationKind) summary.calls += 1;
          for (const recordKind of kinds) {
            const data = {
              scope: () => ({ scopeKind: kind, parent: parentScope, owner: frame.record }),
              declaration: () => ({ nameId, declarationKind: frame.parent?.kind || kind, flags, initializer: null, typeSyntax: null }),
              occurrence: () => ({ nameId, roles, expression: frame.record, flags }),
              statement: () => ({ astKind: kind, statementKind: kind, flags }),
              expression: () => ({ astKind: kind, operation: frame.operation || null, invocationKind,
                syntacticArgumentCount: invocationKind ? (node.arguments?.length ?? node.template?.templateSpans?.length ?? 0) : null, flags }),
              literal: () => ({ literalKind: kind, textRef: { span }, scalar: null })
            }[recordKind]();
            summary.nodes += 1;
            yield { family: 'node', row: { id: ids[recordKind], kind: recordKind, span,
              scope: recordKind === 'scope' ? parentScope : frame.scope, data } };
          }
          if (frame.parent) {
            const parentKind = frame.parent.kind;
            const operandFlags = [];
            if (kind === 'SpreadElement' || kind === 'SpreadAssignment') operandFlags.push('spread');
            if (node.dotDotDotToken) operandFlags.push('rest');
            if (kind === 'ComputedPropertyName') operandFlags.push('computed');
            if (kind === 'ShorthandPropertyAssignment') operandFlags.push('shorthand');
            if (frame.parent.node.questionDotToken) operandFlags.push('optional');
            summary.operands += 1;
            yield { family: 'operand', row: { parent: frame.parent.record, slot: slotFor(parentKind, frame.field), ordinal: frame.ordinal, child: frame.record, flags: operandFlags } };
            if (frame.field === 'expression' && parentKind === 'TemplateSpan'
              && frame.parent.parent?.kind === 'TemplateExpression'
              && frame.parent.parent.parent?.kind === 'TaggedTemplateExpression') {
              summary.operands += 1;
              yield { family: 'operand', row: { parent: frame.parent.parent.parent.record,
                slot: 'argument', ordinal: frame.parent.ordinal, child: frame.record, flags: [] } };
            }
            if (frame.field === 'expression' && ['PropertyAccessExpression', 'ElementAccessExpression'].includes(parentKind)
              && frame.parent.field === 'expression' && ['CallExpression', 'NewExpression'].includes(frame.parent.parent?.kind)) {
              summary.operands += 1;
              yield { family: 'operand', row: { parent: frame.parent.parent.record, slot: 'receiver', ordinal: 0, child: frame.record, flags: [] } };
            }
          }
        }
        if (frame.keyIndex >= frame.keys.length) { stack.pop(); continue; }
        const field = frame.keys[frame.keyIndex];
        const children = node[field];
        const list = Array.isArray(children);
        if (frame.childIndex >= (list ? children.length : 1)) { frame.keyIndex += 1; frame.childIndex = 0; continue; }
        const ordinal = frame.childIndex++;
        const child = list ? children[ordinal] : children;
        if (!child || typeof child.kind !== 'number') continue;
        if (child.kind === ts.SyntaxKind.OmittedExpression && field === 'elements') {
          summary.operands += 1;
          yield { family: 'operand', row: { parent: frame.record, slot: 'element', ordinal, child: null, flags: ['hole'] } };
          continue;
        }
        const binding = (field === 'name' && ['VariableDeclaration', 'Parameter', 'BindingElement'].includes(frame.kind))
          || (frame.binding && field === 'elements');
        const assignment = frame.kind === 'BinaryExpression' && field === 'left'
          && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
        const targetRoles = assignment ? (node.operatorToken.kind === ts.SyntaxKind.EqualsToken
          ? ['write', 'reference'] : ['read', 'write', 'reference'])
          : frame.targetRoles && ((frame.kind === 'ObjectLiteralExpression' && field === 'properties')
            || (frame.kind === 'ArrayLiteralExpression' && field === 'elements')
            || (frame.kind === 'PropertyAssignment' && field === 'initializer')
            || (frame.kind === 'ShorthandPropertyAssignment' && field === 'name')
            || (['SpreadElement', 'SpreadAssignment', 'ParenthesizedExpression'].includes(frame.kind) && field === 'expression')) ? frame.targetRoles : null;
        const typeOnly = frame.typeOnly || node.isTypeOnly || ts.isTypeNode(node)
          || ['type', 'typeArguments', 'typeParameters'].includes(field)
          || ['InterfaceDeclaration', 'TypeAliasDeclaration'].includes(frame.kind);
        stack.push({ node: child, scope: frame.scope, parent: frame, field, ordinal, binding, targetRoles, typeOnly, entered: false });
      }
      summary.state = summary.unsupported || ast.parseDiagnostics?.length ? 'partial' : 'complete';
      yield coverage('syntax', summary.state, summary.state === 'complete' ? null : [
        ...(unsupportedKinds.size ? ['unsupported_syntax:' + [...unsupportedKinds].sort().join(',')] : []),
        ...(ast.parseDiagnostics?.length ? ['recovered_syntax:' + [...new Set(ast.parseDiagnostics.map(error => error.code))].sort().join(',')] : [])
      ].join(';'), summary.nodes, summary.nodes);
    }
    for (const phase of ['bindings', 'localFlow', 'crossFileFlow', 'boundaryModels']) yield coverage(phase, 'unsupported', 'analysis_implementation_pending');
  }
  function* batches() {
    let batch = []; let byteCount = 0; let sequence = 0;
    for (const entry of rows()) {
      throwIfAborted(signal);
      const bytes = Buffer.byteLength(canonicalSemanticJson(entry)) + 1;
      if (bytes > batchBytes) throw Object.assign(new Error('Semantic record exceeds producer batch allowance.'), { code: 'ERR_SEMANTIC_RECORD_LIMIT' });
      if (batch.length && (batch.length >= batchRows || byteCount + bytes > batchBytes)) {
        yield { partitionId, sequence: sequence++, rows: batch, byteCount };
        throwIfAborted(signal);
        batch = []; byteCount = 0;
      }
      batch.push(entry); byteCount += bytes;
    }
    if (batch.length) yield { partitionId, sequence, rows: batch, byteCount };
  }
  return { batches: batches(), summary, structuralSlots: TYPESCRIPT_STRUCTURAL_SLOTS };
};
export const createSemanticCollector = createTypeScriptSemanticCollector;
