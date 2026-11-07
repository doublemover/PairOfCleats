import { getNamedChild, getNamedChildCount } from './ast.js';

/** Only grammar-transparent parentheses may supply a declaration's root role.
 * Fields, constraints, elements and results are never searched recursively. */
export const resolveGoDeclaredType = (node, observe = null) => {
  let type = node.childForFieldName?.('type') || null, wrappers = 0;
  while (type?.type === 'parenthesized_type') {
    wrappers++; observe?.(type);
    if (type.hasError || wrappers > 200000) return null;
    const children = [];
    for (let index = 0; index < getNamedChildCount(type); index++) {
      const child = getNamedChild(type,index);
      if (child && !child.isExtra && child.type !== 'comment') children.push(child);
    }
    if (children.length !== 1) return null;
    type = children[0];
  }
  return type;
};
