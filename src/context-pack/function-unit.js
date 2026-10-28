import path from 'node:path';
import { createRequire } from 'node:module';
import { throwIfAborted } from '../shared/abort.js';

const require = createRequire(import.meta.url);
export const FUNCTION_UNIT_SOURCE_MAX_BYTES = 1024 * 1024;
const extensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const callables = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ClassMethod', 'ClassPrivateMethod', 'ObjectMethod']);
const unavailable = message => Object.assign(new Error(message), { code: 'ERR_CONTEXT_PACK_UNIT_UNAVAILABLE', status: 400 });
const span = node => {
  const start = node?.start ?? node?.range?.[0], end = node?.end ?? node?.range?.[1];
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start ? [start, end] : null;
};
const equal = (left, right) => left && right && left[0] === right[0] && left[1] === right[1];

/** A freshly parsed, hash-verified complete program qualifies exact callable or
 * single-binding/export associations. Containment/name alone is insufficient:
 * a split fragment cannot silently acquire a different nested function owner.
 */
export const selectCompleteFunctionUnit = ({ text, chunk, signal, checkDeadline = () => {}, maxWorkUnits = null }) => {
  throwIfAborted(signal); checkDeadline();
  const ext = path.extname(chunk.file).toLowerCase();
  if (!extensions.has(ext)) throw unavailable('This source dialect has no qualified complete-function adapter.');
  const requested = span(chunk);
  if (!requested || requested[1] > text.length) throw unavailable('The indexed function source span is invalid.');
  const retained = Number.isSafeInteger(chunk.meta?.definitionStart) && Number.isSafeInteger(chunk.meta?.definitionEnd)
    ? span({ start: chunk.meta.definitionStart, end: chunk.meta.definitionEnd }) : null;
  const limit = Math.min(100000, maxWorkUnits ?? 100000);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw unavailable('Complete-function qualification has no work allowance.');
  // Existing parser family/version and dialect owners remain authoritative.
  // Loading is deferred so file/exploration requests acquire no parser imports.
  const { parseJavaScriptAst, getJavaScriptSyntaxIdentity } = require('../lang/javascript/parse.js');
  const ast = parseJavaScriptAst(text, { ext, parser: 'babel' });
  const parser = ast && getJavaScriptSyntaxIdentity(ast);
  throwIfAborted(signal); checkDeadline();
  if (!ast || ast.errors?.length || !parser?.family || !parser?.version) throw unavailable('The complete source program does not have qualified syntax boundaries.');
  const pending = [{ node: ast, parent: null, grandparent: null, greatGrandparent: null }], matches = [];
  let visited = 0;
  while (pending.length) {
    if (++visited > limit) throw unavailable('Complete-function qualification exhausted its traversal allowance.');
    if (visited % 128 === 0) { throwIfAborted(signal); checkDeadline(); }
    const { node, parent, grandparent, greatGrandparent } = pending.pop();
    if (callables.has(node.type) && node.body) {
      const own = span(node), associations = own ? [own] : [];
      if (['ExportNamedDeclaration', 'ExportDefaultDeclaration'].includes(parent?.type) && parent.declaration === node) associations.push(span(parent));
      if (parent?.type === 'VariableDeclarator' && parent.init === node && grandparent?.type === 'VariableDeclaration'
        && grandparent.declarations.length === 1) {
        associations.push(span(['ExportNamedDeclaration', 'ExportDefaultDeclaration'].includes(greatGrandparent?.type)
          && greatGrandparent.declaration === grandparent ? greatGrandparent : grandparent));
      }
      if (parent?.type === 'MethodDefinition' && parent.value === node) associations.push(span(parent));
      const exact = associations.find(range => equal(range, requested));
      const retainedAssociation = retained && associations.find(range => equal(range, retained)
        && requested[0] >= range[0] && requested[1] <= range[1]);
      const admitted = exact || retainedAssociation;
      if (admitted && admitted[1] <= text.length) {
        matches.push({ span: admitted, parser: { family: parser.family, version: parser.version }, visited });
        if (matches.length > 1) throw unavailable('The indexed span has ambiguous complete-function ownership.');
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'range', 'tokens', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'errors'].includes(key)) continue;
      for (const child of Array.isArray(value) ? value : [value]) {
        if (!child || typeof child !== 'object' || typeof child.type !== 'string') continue;
        if (pending.length === 10000) throw unavailable('Complete-function qualification exhausted its pending-node allowance.');
        pending.push({ node: child, parent: node, grandparent: parent, greatGrandparent: grandparent });
      }
    }
  }
  throwIfAborted(signal); checkDeadline();
  if (matches.length !== 1) throw unavailable('The indexed span lacks an exact qualified complete-function association.');
  return { ...matches[0], visited };
};
