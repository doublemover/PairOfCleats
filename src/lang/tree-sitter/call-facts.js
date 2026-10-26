import { projectNativeCallArguments } from './call-arguments.js';
import { getNamedChild, getNamedChildCount } from './ast.js';
import { buildLineIndex, offsetToLine } from '../../shared/lines.js';
import { createOwnedNativeFlow, MANAGED_NATIVE_FLOW_LANGUAGES } from './flow-facts.js';

export const SYNTAX_CALL_FACTS_VERSION = 8;
const callTypes = new Set(['call_expression', 'function_call', 'call', 'method_invocation', 'invocation_expression', 'function_call_expression', 'juxt_function_call',
  'member_call_expression', 'nullsafe_member_call_expression', 'scoped_call_expression', 'object_creation_expression', 'command']);
const scopeBarriers = new Set(['function_definition', 'function_declaration', 'method', 'singleton_method', 'function_item',
  'method_definition', 'method_declaration', 'constructor_declaration', 'lambda_expression', 'lambda', 'lambda_literal',
  'closure_expression', 'closure', 'do_clause', 'arrow_function_expression', 'anonymous_function', 'function_literal',
  'anonymous_function_creation_expression', 'arrow_function', 'function_expression',
  'class_declaration', 'class_definition', 'struct_definition', 'object_definition']);
const field = (node, key) => node?.childForFieldName?.(key);
const textOf = (node, text) => node ? text.slice(node.startIndex, node.endIndex) : '';
const keyOf = node => `${node.startIndex}:${node.endIndex}`;
const dartCallTarget = (node, text) => {
  if (node.type !== 'argument_part' || node.parent?.type !== 'selector') return null;
  const selector = node.parent;
  let target = selector.previousNamedSibling;
  for (let depth = 0; target?.type === 'selector' && depth < 32; depth++) target = target.previousNamedSibling;
  if (!['identifier', 'this', 'super', 'type_identifier'].includes(target?.type)) return null;
  return { type: 'dart-call-target', startIndex: target.startIndex, endIndex: selector.startIndex,
    text: text.slice(target.startIndex, selector.startIndex).trim() };
};

/** Copy compact ordinary call-detail data before the parser-owned tree closes.
 * A traversal interruption fails closed; it never labels a partial tail complete.
 */
export const attachSyntaxCallFacts = (root, text, chunks, { maxNodes = 250000, declarations = null, languageId = null } = {}) => {
  const flow = MANAGED_NATIVE_FLOW_LANGUAGES.has(languageId) ? createOwnedNativeFlow({ text, languageId, chunks }) : null;
  const owners = new Map();
  const omissions = new Map();
  for (const chunk of chunks) {
    if (!/Function|Method|Constructor|Initializer|Deinitializer/.test(chunk.kind)) continue;
    owners.set(`${chunk.meta?.definitionStart ?? chunk.start}:${chunk.meta?.definitionEnd ?? chunk.end}`, chunk);
    chunk.meta.syntaxCalls = [];
    omissions.set(chunk, { anonymousScopeCalls: 0, declarationHeaderCalls: 0 });
  }
  if (declarations) for (const [key, chunk] of declarations) {
    owners.set(key, chunk);
    if (!omissions.has(chunk)) omissions.set(chunk, { anonymousScopeCalls: 0, declarationHeaderCalls: 0 });
  }
  const finish = truncated => {
    flow?.finish({ truncated, parserRecovered: root.hasError !== false });
    for (const chunk of chunks) if (chunk.meta?.syntaxCalls) {
      const omitted = omissions.get(chunk);
      chunk.meta.syntaxCalls = Object.freeze(chunk.meta.syntaxCalls);
      chunk.meta.syntaxCallOmissions = Object.freeze(omitted);
      const reasons = [
        ...(truncated ? ['traversal-budget'] : []),
        ...(omitted?.anonymousScopeCalls ? ['unowned-callable-scope'] : []),
        ...(omitted?.declarationHeaderCalls ? ['declaration-header-call-roles'] : [])
      ];
      chunk.meta.syntaxCallCoverage = reasons.length ? 'partial-' + reasons.join(';') : 'complete-supported-call-roles';
    }
  };
  const lines = buildLineIndex(text), stack = [{ node: root, owner: null, blockedOwner: null, exclusion: null }];
  let visited = 0;
  while (stack.length) {
    if (++visited > maxNodes) {
      finish(true);
      return;
    }
    const { node, owner: inherited, blockedOwner: inheritedBlocked, exclusion: inheritedExclusion } = stack.pop();
    const declared = owners.get(keyOf(node)) || (languageId === 'dart' && node.type === 'function_body'
      && node.previousNamedSibling ? owners.get(keyOf(node.previousNamedSibling)) : null);
    let owner = declared || inherited, blockedOwner = declared ? null : inheritedBlocked;
    let exclusion = declared ? null : inheritedExclusion;
    const declarationBody = node.type === 'closure' && owner
      && node.startIndex === owner.meta?.bodyStart && node.endIndex === owner.meta?.bodyEnd;
    const statement = node.parent?.type === 'expression_statement' ? node.parent : node;
    const controlBody = languageId === 'groovy' && node.type === 'closure'
      && ['if_statement', 'while_statement', 'for_statement', 'enhanced_for_statement', 'do_statement'].includes(statement.parent?.type)
      && ['body', 'consequence', 'alternative'].some(name => {
        const body = field(statement.parent, name);
        return body && keyOf(body) === keyOf(statement);
      });
    if (scopeBarriers.has(node.type) && !declared && !declarationBody && !controlBody) {
      blockedOwner = owner || blockedOwner; owner = null; exclusion = 'anonymousScopeCalls';
    }
    // Julia represents declaration signatures with the same call_expression
    // role as invocation syntax. Default/header evaluation needs a separate
    // owner; neither the signature nor its calls are ordinary function-body calls.
    if (languageId === 'julia' && node.type === 'signature') {
      blockedOwner = owner || blockedOwner; owner = null; exclusion = 'declarationHeaderCalls';
    }
    // C++ defaults are substituted at a call site; signature queries and
    // constraints are not ordinary body executions. Keep the missing execution
    // owner explicit instead of attaching them to a prototype or definition.
    if (['clike', 'cpp'].includes(languageId) && ['parameter_list', 'requires_clause', 'requires_expression',
      'noexcept', 'noexcept_specifier', 'decltype'].includes(node.type)) {
      blockedOwner = owner || blockedOwner; owner = null; exclusion = 'declarationHeaderCalls';
    }
    if (owner) flow?.observe(owner, node);
    const dartTarget = languageId === 'dart' ? dartCallTarget(node, text) : null;
    const invocation = callTypes.has(node.type) || dartTarget !== null;
    if (!owner && blockedOwner && invocation) omissions.get(blockedOwner)[exclusion]++;
    if (owner && invocation) {
      const calleeNode = dartTarget || field(node, 'function') || field(node, 'name') || field(node, 'method') || field(node, 'constructor') || field(node, 'type')
        || (languageId === 'perl' ? field(node, 'function_name') : null)
        || (['julia', 'kotlin'].includes(languageId) && node.type === 'call_expression' ? getNamedChild(node, 0) : null);
      let callee = dartTarget?.text ?? textOf(calleeNode, text);
      const receiver = field(node, 'receiver') || field(node, 'object') || field(node, 'scope')
        || (languageId === 'perl' ? field(node, 'package_name') : null);
      if (receiver && callee && receiver.endIndex <= calleeNode.startIndex) callee = `${textOf(receiver,text)}.${callee}`;
      const dynamicRole = ['subscript_expression', 'element_access_expression', 'index_expression',
        'array_access_expression', 'parenthesized_expression', 'call_expression', 'lambda_expression'].includes(calleeNode?.type);
      const staticName = !dynamicRole && /^[\p{L}_$][\p{L}\p{N}_$!.:\\?=+\-*/<>\[\]]*$/u.test(callee);
      const start = dartTarget?.startIndex ?? node.startIndex;
      const startLine = offsetToLine(lines, start), endLine = offsetToLine(lines, node.endIndex);
      const raw = callee || textOf(node, text);
      let previewEnd = Math.min(raw.length, 512);
      if (previewEnd < raw.length && /[\uD800-\uDBFF]/.test(raw[previewEnd - 1])) previewEnd -= 1;
      const detail = Object.freeze({ caller: owner.name, callee: staticName ? callee.replace(/::|:/g,'.') : null,
        calleeRaw: raw.slice(0, previewEnd), rawPreviewTruncated: previewEnd < raw.length,
        start, end: node.endIndex, line: startLine,
        startLine, endLine, startCol: start - lines[startLine - 1] + 1,
        endCol: node.endIndex - lines[endLine - 1] + 1,
        role: node.type === 'object_creation_expression' ? 'constructor' : 'call',
        resolution: 'unresolved', reason: staticName ? 'syntax-target-unresolved' : 'dynamic-call-target',
        coordinateSystem: 'utf16', source: 'tree-sitter',
        arguments: projectNativeCallArguments(node, text, languageId),
        callerStart: owner.start, callerEnd: owner.end });
      owner.meta.syntaxCalls.push(detail);
    }
    for (let i = getNamedChildCount(node) - 1; i >= 0; i--) stack.push({ node: getNamedChild(node,i), owner, blockedOwner, exclusion });
  }
  finish(false);
};

export const syntaxRelationsForChunks = chunks => {
  const calls = [], callDetails = [], seen = new Set();
  for (const chunk of chunks || []) for (const detail of chunk.meta?.syntaxCalls || []) {
    // Native-owner facts stay immutable; inference owns mutable resolution
    // annotations on this derived view, never on the parser snapshot.
    callDetails.push({ ...detail });
    if (!detail.callee) continue;
    const key = JSON.stringify([chunk.name,detail.callee]);
    if (!seen.has(key)) { seen.add(key); calls.push([chunk.name,detail.callee]); }
  }
  return { calls, callDetails, callOwnership: 'native-syntax-occurrences-v1',
    usages: [...new Set(callDetails.map(detail => detail.callee).filter(Boolean))] };
};
