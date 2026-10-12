import { createRequire } from 'node:module';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getNativeTreeSitterParser, NATIVE_GRAMMAR_MODULES } from '../../lang/tree-sitter/native-runtime.js';
import { canonicalSemanticJson } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';

export const NATIVE_SYNTAX_VERSION = '1';
export const NATIVE_SEMANTIC_LANGUAGES = Object.freeze(['python', 'c', 'swift', 'rust']);
const require = createRequire(import.meta.url);
const version = name => { try { return require(name + '/package.json').version; } catch { return null; } };
export const nativeSemanticParserVersions = () => Object.fromEntries(NATIVE_SEMANTIC_LANGUAGES.map(language =>
  [language, { runtime: version('tree-sitter'), grammar: version(NATIVE_GRAMMAR_MODULES[language].moduleName), adapter: NATIVE_SYNTAX_VERSION }]));
export const semanticSourceLanguage = (language, filename) => language === 'clike' && ['.c', '.h'].includes(path.extname(filename).toLowerCase()) ? 'c' : language;
const roots = new Set(['module', 'translation_unit', 'source_file']);
export const nativeFunctionKinds = new Set(['function_definition', 'function_declaration', 'function_item', 'lambda', 'lambda_literal', 'closure_expression']);
const scopes = new Set([...roots, ...nativeFunctionKinds, 'class_definition', 'class_declaration', 'class_body', 'struct_item', 'impl_item', 'trait_item', 'block', 'compound_statement', 'function_body']);
const identifiers = new Set(['identifier', 'simple_identifier', 'type_identifier', 'field_identifier', 'shorthand_field_identifier']);
const declarations = new Set([...nativeFunctionKinds, 'class_definition', 'class_declaration', 'struct_specifier', 'enum_specifier', 'struct_item', 'enum_item', 'trait_item', 'type_item', 'const_item', 'static_item', 'mod_item', 'enum_variant', 'field_declaration', 'parameter', 'default_parameter', 'aliased_import', 'use_as_clause']);
const containers = new Set(['parameters', 'parameter_list', 'closure_parameters']);
const patterns = new Set(['pattern_list', 'tuple_pattern', 'list_pattern', 'list_splat_pattern', 'dictionary_splat_pattern', 'tuple_expression', 'mut_pattern', 'ref_pattern', 'reference_pattern', 'slice_pattern', 'pattern']);
const declarators = new Set(['declaration', 'field_declaration', 'parameter_declaration', 'type_definition', 'function_definition', 'function_declarator', 'pointer_declarator', 'array_declarator', 'parenthesized_declarator', 'init_declarator']);
const calls = new Set(['call', 'call_expression']);
const argumentLists = new Set(['argument_list', 'arguments', 'value_arguments']);
const operators = new Set(['+', '-', '*', '/', '%', '**', '==', '!=', '<', '>', '<=', '>=', '=', '+=', '-=', '*=', '/=', '%=', '&', '|', '^', '&&', '||', 'and', 'or', 'not', '!', '~', '<<', '>>', '??', '++', '--', '..', '..=']);
const field = (node, name) => node.childForFieldName(name);
export const nativeChildren = node => Array.from({ length: node.namedChildCount }, (_, i) => node.namedChild(i));
export const nativeTransfer = node => node.type === 'control_transfer_statement'
  ? Array.from({ length: node.childCount }, (_, i) => node.child(i).type).find(type => ['return', 'throw', 'break', 'continue'].includes(type)) || null
  : ({ return_statement: 'return', return_expression: 'return', raise_statement: 'throw', throw_statement: 'throw', break_statement: 'break', break_expression: 'break', continue_statement: 'continue', continue_expression: 'continue' })[node.type] || null;

/** One owned tree from the existing native runtime; it never crosses workers. */
export const prepareNativeSemanticSyntax = ({ text, language, enabled = true }) => {
  if (!NATIVE_SEMANTIC_LANGUAGES.includes(language)) return null;
  const versions = nativeSemanticParserVersions()[language];
  const identity = { family: 'native-tree-sitter', version: versions.runtime || 'unavailable', options: { language, grammarVersion: versions.grammar, enabled } };
  if (!enabled) return { identity, unavailable: { state: 'disabled', reason: 'native_parser_policy_disabled' } };
  const parser = getNativeTreeSitterParser(language);
  if (!parser || !versions.runtime || !versions.grammar) return { identity, unavailable: { state: 'unsupported', reason: 'native_parser_unavailable' } };
  const tree = parser.parse(text);
  if (!tree) return { identity, unavailable: { state: 'failed', reason: 'native_parser_no_tree' } };
  return { tree, identity, textHash: createHash('sha256').update(text).digest('hex'), close: () => tree.delete?.() };
};

const bindingChild = (frame, child, childField) => {
  const node = frame.node, kind = node.type;
  if (declarations.has(kind) && ['name', 'alias'].includes(childField)) return identifiers.has(child.type);
  if (declarators.has(kind) && childField === 'declarator') return true;
  if (containers.has(kind)) return true;
  if (kind === 'typed_parameter' && childField !== 'type') return true;
  if (['let_declaration', 'parameter', 'for_expression'].includes(kind) && childField === 'pattern') return true;
  if (['assignment', 'for_statement', 'named_expression'].includes(kind) && childField === 'left') return true;
  if (kind === 'property_declaration' && childField === 'name' || kind === 'for_statement' && childField === 'item') return true;
  return frame.binding && patterns.has(kind) && !['type', 'value'].includes(childField);
};
const childSlot = (node, childField) => {
  if (calls.has(node.type) && childField === 'function') return 'callee';
  if (childField === 'arguments') return 'body'; // Actual arguments are flattened below.
  if (['left', 'right', 'body', 'condition', 'initializer'].includes(childField)) return childField;
  if (childField === 'parameters') return 'body';
  if (childField === 'consequence') return 'trueValue';
  if (childField === 'alternative') return 'falseValue';
  if (childField === 'object' || childField === 'value' && node.type === 'field_expression') return 'object';
  if (childField === 'index') return 'index';
  if (nativeTransfer(node) === 'return') return 'returnValue';
  if (nativeTransfer(node) === 'throw') return 'throwValue';
  if (childField === 'value' && ['assignment', 'init_declarator', 'let_declaration', 'property_declaration', 'default_parameter'].includes(node.type)) return 'initializer';
  return 'ast:NativeSyntax.child';
};

/** Full named syntax traversal, with grammar roles rather than name matching.
 * Compiler/LSP evidence is responsible for symbol and cross-file identity.
 */
export const createNativeSemanticCollector = ({ syntax, source, partitionId, unavailable = null, signal = null }, policy = {}) => {
  const batchRows = policy.batchRows ?? 4096, batchBytes = policy.batchBytes ?? 1048576;
  if (!Number.isSafeInteger(batchRows) || batchRows < 1 || !Number.isSafeInteger(batchBytes) || batchBytes < 1) throw new TypeError('Positive semantic batch limits required.');
  if (syntax?.tree && syntax.textHash !== source.textHash) throw new TypeError('Native syntax/source identity mismatch.');
  const names = new Map(), anchors = new Map(), owners = [], summary = { nodes: 0, operands: 0, calls: 0, unsupported: 0, state: 'partial' };
  let nextId = 0;
  const ref = localId => ({ partitionId, localId });
  const coverage = (phase, state, reason, observedCount = null, completedCount = 0) => ({ family: 'coverage', row: {
    scope: { sourceUnitId: source.sourceUnitId }, phase, state, reason, observedCount, completedCount, frontierRef: null
  } });
  function* rows() {
    const missing = unavailable || syntax?.unavailable;
    if (missing || !syntax?.tree) { summary.state = missing?.state || 'unsupported'; yield coverage('syntax', summary.state, missing?.reason || 'native_parser_unavailable'); return; }
    const stack = [{ node: syntax.tree.rootNode, parent: null, scope: null, childIndex: 0, entered: false, binding: false, typeOnly: false }];
    while (stack.length) {
      throwIfAborted(signal);
      const frame = stack[stack.length - 1], node = frame.node, kind = node.type;
      if (!frame.entered) {
        frame.entered = true;
        const span = [node.startIndex, node.endIndex];
        if (span.some(value => !Number.isSafeInteger(value) || value < 0) || span[1] < span[0] || span[1] > source.textLength) throw new TypeError('Native parser offset is not UTF16 source coordinates.');
        const identifier = identifiers.has(kind) && node.text !== '_';
        let roles = frame.binding ? ['definition'] : ['read', 'reference'];
        if (identifier && !frame.binding) {
          if (frame.field === 'external_name' || frame.parent?.node.type === 'value_argument_label') roles = ['property'];
          else if (['field', 'attribute'].includes(frame.field)) roles = ['property', 'reference'];
          if (frame.slot === 'callee' || frame.parent?.slot === 'callee' && ['name', 'field', 'attribute'].includes(frame.field)) roles = ['call', 'reference'];
          if (frame.field === 'left' && /assignment/.test(frame.parent?.node.type || '')) roles = ['write', 'reference'];
          if (/^import|^use_/.test(frame.parent?.node.type || '')) roles = ['import', 'reference'];
        }
        const lexicalScope = scopes.has(kind) && !(source.language === 'python' && kind === 'block');
        const recordKinds = [...(lexicalScope ? ['scope'] : []), ...(identifier && frame.binding ? ['declaration'] : []),
          ...(identifier ? ['occurrence'] : []), ...(/statement$|declaration$|_item$|^module$|^translation_unit$|^source_file$/.test(kind) ? ['statement'] : []), 'expression',
          ...(/literal$|^integer$|^float$|^string$|^true$|^false$|^none$/.test(kind) ? ['literal'] : [])];
        const ids = Object.fromEntries(recordKinds.map(recordKind => [recordKind, nextId++]));
        frame.record = ref(ids.expression); anchors.set(node.id, frame.record);
        const parentScope = frame.scope;
        if (ids.scope !== undefined) frame.scope = ref(ids.scope);
        if (nativeFunctionKinds.has(kind) || roots.has(kind)) owners.push(node);
        let nameId = null;
        if (identifier) {
          if (!names.has(node.text)) { names.set(node.text, names.size); yield { family: 'lookup', row: { kind: 'name', id: names.get(node.text), value: node.text } }; }
          nameId = names.get(node.text);
        }
        const flags = ['nativeSyntax', ...(frame.typeOnly || kind === 'type_identifier' ? ['typeOnly'] : []), ...(node.isMissing || kind === 'ERROR' ? ['recoveredSyntax'] : [])];
        if (node.isMissing || kind === 'ERROR') summary.unsupported += 1;
        const invocationKind = calls.has(kind) ? 'call' : null;
        const argumentsNode = invocationKind ? field(node, 'arguments') || nativeChildren(node).find(child => child.type === 'call_suffix')?.namedChildren?.find(child => child.type === 'value_arguments') : null;
        if (invocationKind) summary.calls += 1;
        const operator = field(node, 'operator')?.text || Array.from({ length: node.childCount }, (_, i) => node.child(i)).find(child => !child.isNamed && operators.has(child.type))?.type || null;
        for (const recordKind of recordKinds) {
          const data = {
            scope: () => ({ scopeKind: kind, parent: parentScope, owner: frame.record }),
            declaration: () => ({ nameId, declarationKind: frame.parent?.node.type || kind, flags, initializer: null, typeSyntax: null }),
            occurrence: () => ({ nameId, roles, expression: frame.record, flags }),
            statement: () => ({ astKind: kind, statementKind: nativeTransfer(node) || kind, flags }),
            expression: () => ({ astKind: kind, operation: operator, invocationKind, syntacticArgumentCount: invocationKind ? argumentsNode?.namedChildCount ?? 0 : null, flags }),
            literal: () => ({ literalKind: kind, textRef: { span }, scalar: null })
          }[recordKind]();
          summary.nodes += 1;
          yield { family: 'node', row: { id: ids[recordKind], kind: recordKind, span, scope: recordKind === 'scope' ? parentScope : frame.scope, data } };
        }
        if (frame.parent) {
          summary.operands += 1;
          yield { family: 'operand', row: { parent: frame.parent.record, slot: frame.slot, ordinal: frame.ordinal, child: frame.record, flags: [] } };
          const parent = frame.parent;
          let invocation = argumentLists.has(parent.node.type) ? parent.parent : null;
          if (invocation?.node.type === 'call_suffix') invocation = invocation.parent;
          if (invocation && calls.has(invocation.node.type)) {
            summary.operands += 1;
            yield { family: 'operand', row: { parent: invocation.record, slot: 'argument', ordinal: frame.ordinal, child: frame.record, flags: [] } };
          }
        }
      }
      if (frame.childIndex >= node.namedChildCount) { stack.pop(); continue; }
      const ordinal = frame.childIndex++, child = node.namedChild(ordinal), childField = node.fieldNameForNamedChild(ordinal);
      let slot = childSlot(node, childField);
      if (source.language === 'swift' && calls.has(kind) && ordinal === 0) slot = 'callee';
      if (containers.has(kind)) slot = 'parameter';
      stack.push({ node: child, parent: frame, field: childField, slot, ordinal, scope: frame.scope,
        binding: bindingChild(frame, child, childField), typeOnly: frame.typeOnly || ['type', 'return_type'].includes(childField) || ['type_annotation', 'user_type', 'type_arguments'].includes(child.type), childIndex: 0, entered: false });
    }
    summary.state = syntax.tree.rootNode.hasError || summary.unsupported ? 'partial' : 'complete';
    yield coverage('syntax', summary.state, summary.state === 'complete' ? null : 'native_recovered_syntax', summary.nodes, summary.nodes);
    yield coverage('bindings', 'unsupported', 'compiler_provider_evidence_required');
    yield coverage('localFlow', 'unsupported', 'native_flow_requires_eager_admission');
    yield coverage('crossFileFlow', 'unsupported', 'provider_bindings_do_not_prove_interprocedural_value_flow');
    yield coverage('boundaryModels', 'unsupported', 'native_runtime_effects_unknown');
  }
  function* batches() {
    let rowsBatch = [], byteCount = 0, sequence = 0;
    for (const entry of rows()) {
      const bytes = Buffer.byteLength(canonicalSemanticJson(entry)) + 1;
      if (bytes > batchBytes) throw Object.assign(new Error('Native semantic row exceeds batch allowance.'), { code: 'ERR_SEMANTIC_RECORD_LIMIT' });
      if (rowsBatch.length && (rowsBatch.length >= batchRows || byteCount + bytes > batchBytes)) { yield { partitionId, sequence: sequence++, rows: rowsBatch, byteCount }; rowsBatch = []; byteCount = 0; }
      rowsBatch.push(entry); byteCount += bytes;
    }
    if (rowsBatch.length) yield { partitionId, sequence, rows: rowsBatch, byteCount };
  }
  return { batches: batches(), summary, structuralSlots: ['ast:NativeSyntax.child'], anchors, owners };
};
