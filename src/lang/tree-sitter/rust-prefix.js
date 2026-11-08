import { getNamedChild, getNamedChildCount } from './ast.js';

export const RUST_ATTACHED_DOCUMENTATION_VERSION = 1;
export const RUST_PREFIX_RANGE_LIMIT = 512;
const PREVIEW_CHARS = 300;
const field = (node, name) => node?.childForFieldName?.(name);
const source = (node, text) => node ? text.slice(node.startIndex, node.endIndex) : '';
const children = node => Array.from({ length: getNamedChildCount(node) }, (_, index) => getNamedChild(node, index));
const bounds = node => node ? { start: node.startIndex, end: node.endIndex } : null;

/** Read grammar-owned outer comment/attribute siblings once, before releasing
 * the native tree. Raw source coverage is independent of bounded doc previews. */
export const resolveRustDeclaration = (node, text) => {
  const comments = [], attributes = [];
  let previous = node.previousNamedSibling, start = node.startIndex, preview = '', omittedRanges = 0;
  while (previous && ['attribute_item', 'line_comment', 'block_comment'].includes(previous.type)) {
    start = previous.startIndex;
    if (previous.type === 'attribute_item') {
      const attribute = children(previous).find(child => child.type === 'attribute');
      const name = source(children(attribute)[0], text).trim();
      if (comments.length + attributes.length < RUST_PREFIX_RANGE_LIMIT) attributes.push({ ...bounds(previous), role: 'outer-attribute', name });
      else omittedRanges++;
    } else if (field(previous, 'outer')?.type === 'outer_doc_comment_marker' && !field(previous, 'inner')) {
      const doc = field(previous, 'doc');
      const content = source(doc, text).split(/\r?\n/u).map(line => previous.type === 'block_comment'
        ? line.replace(/^\s*\* ?/u, '') : line).join('\n').trim();
      preview = (content + (preview ? '\n' + preview : '')).slice(0, PREVIEW_CHARS);
      if (comments.length + attributes.length < RUST_PREFIX_RANGE_LIMIT) comments.push({ ...bounds(previous),
        role: 'outer-documentation', syntax: previous.type, content: bounds(doc) });
      else omittedRanges++;
    }
    previous = previous.previousNamedSibling;
  }
  comments.reverse(); attributes.reverse();
  const headerEnd = field(node, 'body')?.startIndex ?? node.endIndex;
  const callable = ['function_item', 'function_signature_item'].includes(node.type);
  const declarationChildren = children(node);
  const visibility = declarationChildren.find(child => child.type === 'visibility_modifier');
  const functionModifiers = declarationChildren.find(child => child.type === 'function_modifiers');
  const modifiers = (functionModifiers?.children || []).filter(child => ['async', 'const', 'unsafe', 'default', 'extern_modifier'].includes(child.type))
    .map(child => source(child, text).trim());
  if (visibility) modifiers.unshift(source(visibility, text).trim());
  const parameters = children(field(node, 'parameters')).flatMap(parameter => parameter.type === 'self_parameter' ? ['self']
    : ['parameter', 'variadic_parameter'].includes(parameter.type) && field(parameter, 'pattern')
      ? [source(field(parameter, 'pattern'), text).trim()] : []);
  return { range: { start, end: node.endIndex }, docstring: preview,
    metadata: { attachedDocumentation: { schemaVersion: RUST_ATTACHED_DOCUMENTATION_VERSION,
      coordinateSpace: 'utf16', owner: bounds(node), prefix: { start, end: node.startIndex },
      coverageScope: 'outer-prefix-syntax',
      coverage: omittedRanges ? 'partial' : 'complete', reason: omittedRanges ? 'prefix-range-allowance' : null,
      comments, attributes, omittedRanges, attributeEvaluation: 'not-requested' },
    rustAttributes: [...new Set(attributes.map(row => row.name).filter(Boolean))],
    rustModifiers: modifiers,
    rustDeclarationHeaderRange: { start: node.startIndex, end: headerEnd },
    ...(callable ? { rustParameters: parameters, rustParametersRange: bounds(field(node, 'parameters')),
      rustReturnType: source(field(node, 'return_type'), text).trim() || null } : {}) }
  };
};
