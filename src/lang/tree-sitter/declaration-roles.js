import { getNamedChild, getNamedChildCount } from './ast.js';

const named = node => Array.from({ length: getNamedChildCount(node) }, (_, i) => getNamedChild(node, i));
const children = node => Array.isArray(node?.children) ? node.children : [];
const source = (node, text) => node ? text.slice(node.startIndex, node.endIndex) : '';
const field = (node, name) => node?.childForFieldName?.(name);

export const resolveDeclaratorName = (node, text) => {
  let current = node.type === 'operator_cast' ? node : field(node, 'declarator');
  for (let depth = 0; current && depth < 32; depth++) {
    if (current.type === 'operator_cast') {
      const declarator = field(current, 'declarator');
      // Only the abstract function's parameter list is excluded; conversion
      // pointer/reference spelling preceding it remains part of the name.
      const parameters = declarator && named(declarator).find(child => child.type === 'parameter_list');
      return source(current, text).slice(0, (parameters?.startIndex ?? declarator?.startIndex ?? current.endIndex) - current.startIndex).trim();
    }
    if (['identifier', 'field_identifier', 'type_identifier', 'qualified_identifier', 'operator_name', 'destructor_name'].includes(current.type)) return source(current, text).trim();
    current = field(current, 'declarator') || named(current).find(child => /declarator$/.test(child.type) || prototypeNameNodes.has(child.type));
  }
  return '';
};

const prototypeOwner = node => {
  let current = node.parent;
  for (let depth = 0; current && depth < 32; depth++, current = current.parent) {
    if (['declaration', 'field_declaration'].includes(current.type)) return current;
    if (!/declarator$/.test(current.type)) return null;
  }
  return null;
};
const prototypeNameNodes = new Set(['identifier', 'field_identifier', 'type_identifier', 'qualified_identifier', 'operator_name', 'destructor_name']);
const prototypeNameWrappers = new Set(['parenthesized_declarator', 'parenthesized_field_declarator',
  'attributed_declarator', 'attributed_field_declarator']);
export const isCPrototype = node => {
  if (!prototypeOwner(node)) return false;
  if (node.type === 'operator_cast') return true;
  let name = field(node, 'declarator');
  for (let depth = 0; name && depth < 32; depth += 1) {
    if (prototypeNameNodes.has(name.type)) return true;
    if (!prototypeNameWrappers.has(name.type)) return false;
    const candidates = named(name).filter(child => prototypeNameNodes.has(child.type) || /declarator$/u.test(child.type));
    if (candidates.length !== 1) return false;
    name = candidates[0];
  }
  return false;
};
export const includeCDeclaration = node => ['function_declarator', 'operator_cast'].includes(node.type)
  ? isCPrototype(node) : includeCTagDeclaration(node);
export const resolveCDeclarationRange = node => {
  const owner = ['function_declarator', 'operator_cast'].includes(node.type) ? prototypeOwner(node) : null;
  return owner ? resolveDeclarationPrefixRange(owner) : null;
};
export const resolveCppName = (node, text) => {
  const name = field(node, 'name');
  if (name) return source(name, text).trim();
  const resolved = resolveDeclaratorName(node, text);
  return resolved.replace(/::/g, '.');
};

export const includeCTagDeclaration = node => {
  if (!['struct_specifier', 'enum_specifier', 'union_specifier'].includes(node.type)) return true;
  if (field(node, 'body')) return true;
  if (['translation_unit', 'compound_statement', 'declaration_list', 'field_declaration_list'].includes(node.parent?.type)
    && node.nextSibling?.type === ';') return true;
  // A standalone forward declaration has no object/function declarator.
  return node.parent?.type === 'declaration' && !field(node.parent, 'declarator')
    && named(node.parent).every(child => child.type === node.type && child.startIndex === node.startIndex && child.endIndex === node.endIndex
      || ['attribute_specifier', 'type_qualifier'].includes(child.type));
};

export const resolveCName = (node, text) => {
  if (/function|method/.test(node.type) || node.type === 'operator_cast') return resolveDeclaratorName(node, text);
  const name = field(node, 'name');
  if (name) return source(name, text);
  if (node.parent?.type === 'type_definition') return resolveDeclaratorName(node.parent, text);
  return '';
};

export const resolveSwiftKind = (node, kind) => {
  if (node.type !== 'class_declaration') return kind;
  const role = field(node, 'declaration_kind')?.type;
  return ({ class: 'ClassDeclaration', struct: 'StructDeclaration', enum: 'EnumDeclaration',
    actor: 'ActorDeclaration', extension: 'ExtensionDeclaration' })[role] || kind;
};
export const resolveSwiftName = node => ({ init_declaration: 'init', initializer_declaration: 'init',
  deinit_declaration: 'deinit', deinitializer_declaration: 'deinit', subscript_declaration: 'subscript' })[node.type] || null;

export const resolveKotlinKind = (node, kind) => {
  if (node.type !== 'class_declaration') return kind;
  const tokens = children(node).map(child => child.type);
  if (tokens.includes('enum')) return 'EnumDeclaration';
  if (tokens.includes('interface')) return 'InterfaceDeclaration';
  return kind;
};

const dartSignatures = new Set(['function_signature', 'constructor_signature', 'constant_constructor_signature',
  'factory_constructor_signature', 'redirecting_factory_constructor_signature', 'getter_signature', 'setter_signature', 'operator_signature']);
export const includeDartDeclaration = node => !(dartSignatures.has(node.type) && node.parent?.type === 'method_signature');
export const resolveDartName = (node, text) => {
  const signature = node.type === 'method_signature' ? named(node).find(child => dartSignatures.has(child.type)) : node;
  if (!signature || !dartSignatures.has(signature.type)) return null;
  const names = signature.childrenForFieldName?.('name') || [field(signature, 'name')].filter(Boolean);
  if (names.length) return names.map(part => source(part, text)).join('');
  if (signature.type === 'operator_signature') return source(signature, text).split('(')[0].trim();
  return '';
};
export const resolveDartKind = (node, kind) => node.type === 'method_signature'
  && named(node).some(child => /constructor_signature$/.test(child.type)) ? 'ConstructorDeclaration' : kind;
export const resolveDartRange = node => {
  const next = node.nextNamedSibling;
  if (next?.type === 'function_body') return { start: node.startIndex, end: next.endIndex };
  // Bodyless declarations retain their own semicolon without consuming another
  // signature. The punctuation sibling is deliberately not a text search.
  if (node.nextSibling?.type === ';') return { start: node.startIndex, end: node.nextSibling.endIndex };
  return null;
};

export const resolveGoRange = node => {
  const parent = node.parent;
  if (!['type_spec', 'type_alias'].includes(node.type) || parent?.type !== 'type_declaration') return null;
  const specs = named(parent).filter(child => ['type_spec', 'type_alias'].includes(child.type));
  return specs.length === 1 && !children(parent).some(child => child.type === '(')
    ? { start: parent.startIndex, end: parent.endIndex } : null;
};

export const resolveObjCName = (node, text) => {
  if (['method_definition', 'method_declaration'].includes(node.type)) {
    const parts = [], members = named(node);
    for (let index = 0; index < members.length; index++) {
      const member = members[index];
      if (member.type === 'identifier') {
        const next = members[index + 1];
        parts.push(source(member, text) + (next?.type === 'method_parameter' ? ':' : ''));
      } else if (member.type === 'keyword_declarator') {
        const keyword = named(member).find(child => child.type === 'identifier');
        parts.push(`${source(keyword, text)}:`);
      } else if (member.type === 'method_parameter' && members[index - 1]?.type !== 'identifier') parts.push(':');
      if (member.type === 'compound_statement') break;
    }
    const sign = children(node).find(child => child.type === '+' || child.type === '-')?.type || '-';
    return parts.length ? `${sign}${parts.join('')}` : '';
  }
  if (['class_interface', 'class_implementation', 'category_interface', 'protocol_declaration'].includes(node.type)) {
    const owner = named(node).find(child => child.type === 'identifier');
    const category = field(node, 'category');
    return owner ? `${source(owner, text)}${category ? `(${source(category, text)})` : ''}` : '';
  }
  return resolveCName(node, text);
};

/** Preserve attached syntax while keeping declaration coordinates separately. */
export const resolveDeclarationPrefixRange = node => {
  let wrapper = node;
  while (['decorated_definition', 'template_declaration'].includes(wrapper.parent?.type)) wrapper = wrapper.parent;
  let start = wrapper.startIndex;
  if (['function_item', 'function_signature_item', 'struct_item', 'enum_item', 'trait_item', 'impl_item', 'mod_item'].includes(node.type)) {
    let previous = node.previousNamedSibling;
    while (previous && ['attribute_item', 'line_comment', 'block_comment'].includes(previous.type)) {
      start = previous.startIndex; previous = previous.previousNamedSibling;
    }
  }
  return { start, end: wrapper.endIndex };
};
