export function locMeta(node) {
  return node && node.loc ? {
    startLine: node.loc.start.line,
    endLine: node.loc.end.line
  } : {};
}

export function nodeStart(node) {
  if (!node) return 0;
  if (Number.isFinite(node.start)) return node.start;
  if (Array.isArray(node.range)) return node.range[0];
  return 0;
}

export function nodeEnd(node) {
  if (!node) return 0;
  if (Number.isFinite(node.end)) return node.end;
  if (Array.isArray(node.range)) return node.range[1];
  return 0;
}

export function keyName(key) {
  if (!key) return 'anonymous';
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal') return String(key.value);
  if (key.type === 'StringLiteral' || key.type === 'NumericLiteral') return String(key.value);
  if (key.type === 'PrivateIdentifier') return `#${key.name}`;
  if (key.type === 'PrivateName' && key.id?.name) return `#${key.id.name}`;
  return 'computed';
}

export function visibilityFor(name) {
  if (!name) return 'public';
  if (name.startsWith('#')) return 'private';
  if (name.startsWith('__') && !name.endsWith('__')) return 'private';
  if (name.startsWith('_') && !name.startsWith('__')) return 'protected';
  return 'public';
}

export function collectPatternNames(node, out) {
  if (!node) return;
  if (node.type === 'Identifier') {
    out.push(node.name);
    return;
  }
  if (node.type === 'RestElement') {
    collectPatternNames(node.argument, out);
    return;
  }
  if (node.type === 'AssignmentPattern') {
    collectPatternNames(node.left, out);
    return;
  }
  if (node.type === 'ArrayPattern') {
    node.elements?.forEach((el) => collectPatternNames(el, out));
    return;
  }
  if (node.type === 'ObjectPattern') {
    node.properties?.forEach((prop) => {
      if (prop.type === 'Property' || prop.type === 'ObjectProperty') {
        collectPatternNames(prop.value, out);
      }
      if (prop.type === 'RestElement') collectPatternNames(prop.argument, out);
    });
  }
}

export function formatDefault(node) {
  if (!node) return '...';
  if (node.type === 'Literal') return JSON.stringify(node.value);
  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral') return JSON.stringify(node.value);
  if (node.type === 'BooleanLiteral') return node.value ? 'true' : 'false';
  if (node.type === 'NullLiteral') return 'null';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'TemplateLiteral') return '`...`';
  if (node.type === 'ArrayExpression') return '[...]';
  if (node.type === 'ObjectExpression') return '{...}';
  if (node.type === 'CallExpression') return 'call(...)';
  return '...';
}

export function formatParam(node) {
  if (!node) return 'param';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'RestElement') return `...${formatParam(node.argument)}`;
  if (node.type === 'AssignmentPattern') {
    return `${formatParam(node.left)}=${formatDefault(node.right)}`;
  }
  if (node.type === 'ObjectPattern') return '{...}';
  if (node.type === 'ArrayPattern') return '[...]';
  return 'param';
}
