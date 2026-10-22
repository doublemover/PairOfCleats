import { getNamedChild, getNamedChildCount } from './ast.js';
import { buildLineIndex, offsetToLine } from '../../shared/lines.js';

const callTypes = new Set(['call_expression', 'function_call', 'call', 'method_invocation', 'function_call_expression',
  'member_call_expression', 'nullsafe_member_call_expression', 'scoped_call_expression', 'object_creation_expression', 'command']);
const scopeBarriers = new Set(['function_definition', 'function_declaration', 'method', 'singleton_method', 'function_item',
  'lambda_expression', 'lambda', 'anonymous_function_creation_expression', 'arrow_function', 'function_expression']);
const field = (node, key) => node?.childForFieldName?.(key);
const textOf = (node, text) => node ? text.slice(node.startIndex, node.endIndex) : '';
const keyOf = node => `${node.startIndex}:${node.endIndex}`;

/** Copy compact ordinary call-detail data before the parser-owned tree closes.
 * A traversal interruption fails closed; it never labels a partial tail complete.
 */
export const attachSyntaxCallFacts = (root, text, chunks, { maxNodes = 250000, declarations = null } = {}) => {
  const owners = new Map();
  for (const chunk of chunks) {
    if (!/Function|Method|Constructor|Initializer|Deinitializer/.test(chunk.kind)) continue;
    owners.set(`${chunk.meta?.definitionStart ?? chunk.start}:${chunk.meta?.definitionEnd ?? chunk.end}`, chunk);
    chunk.meta.syntaxCalls = [];
  }
  if (declarations) for (const [key, chunk] of declarations) owners.set(key, chunk);
  const lines = buildLineIndex(text), stack = [{ node: root, owner: null }];
  let visited = 0;
  while (stack.length) {
    if (++visited > maxNodes) {
      for (const chunk of chunks) if (chunk.meta?.syntaxCalls) chunk.meta.syntaxCallCoverage = 'partial-traversal-budget';
      return;
    }
    const { node, owner: inherited } = stack.pop();
    let owner = owners.get(keyOf(node)) || inherited;
    if (scopeBarriers.has(node.type) && !owners.has(keyOf(node))) owner = null;
    if (owner && callTypes.has(node.type)) {
      const calleeNode = field(node, 'function') || field(node, 'name') || field(node, 'method') || field(node, 'constructor') || field(node, 'type');
      let callee = textOf(calleeNode, text);
      const receiver = field(node, 'receiver') || field(node, 'object') || field(node, 'scope');
      if (receiver && callee && receiver.endIndex <= calleeNode.startIndex) callee = `${textOf(receiver,text)}.${callee}`;
      const dynamicRole = ['subscript_expression', 'element_access_expression', 'index_expression',
        'array_access_expression', 'parenthesized_expression', 'call_expression', 'lambda_expression'].includes(calleeNode?.type);
      const staticName = !dynamicRole && /^[\p{L}_$][\p{L}\p{N}_$!.:\\?=+\-*/<>\[\]]*$/u.test(callee);
      const startLine = offsetToLine(lines, node.startIndex), endLine = offsetToLine(lines, node.endIndex);
      const raw = callee || textOf(node, text);
      let previewEnd = Math.min(raw.length, 512);
      if (previewEnd < raw.length && /[\uD800-\uDBFF]/.test(raw[previewEnd - 1])) previewEnd -= 1;
      const detail = Object.freeze({ caller: owner.name, callee: staticName ? callee.replace(/::|:/g,'.') : null,
        calleeRaw: raw.slice(0, previewEnd), rawPreviewTruncated: previewEnd < raw.length,
        start: node.startIndex, end: node.endIndex, line: startLine,
        startLine, endLine, startCol: node.startIndex - lines[startLine - 1] + 1,
        endCol: node.endIndex - lines[endLine - 1] + 1,
        role: node.type === 'object_creation_expression' ? 'constructor' : 'call',
        resolution: 'unresolved', reason: staticName ? 'syntax-target-unresolved' : 'dynamic-call-target',
        coordinateSystem: 'utf16', source: 'tree-sitter',
        callerStart: owner.start, callerEnd: owner.end });
      owner.meta.syntaxCalls.push(detail);
    }
    for (let i = getNamedChildCount(node) - 1; i >= 0; i--) stack.push({ node: getNamedChild(node,i), owner });
  }
  for (const chunk of chunks) if (chunk.meta?.syntaxCalls) {
    chunk.meta.syntaxCalls = Object.freeze(chunk.meta.syntaxCalls);
    chunk.meta.syntaxCallCoverage = 'complete-supported-call-roles';
  }
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
  return { calls, callDetails, usages: [...new Set(callDetails.map(detail => detail.callee).filter(Boolean))] };
};
