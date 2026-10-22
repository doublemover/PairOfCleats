import { getNamedChild, getNamedChildCount } from './ast.js';
const named = node => Array.from({ length:getNamedChildCount(node) },(_,i)=>getNamedChild(node,i));
const field = (node,name) => node?.childForFieldName?.(name);
const source = (node,text) => node ? text.slice(node.startIndex,node.endIndex) : '';

export const callableGrammarMetadata = node => {
  const body = field(node,'body');
  return { definitionStart:node.startIndex,definitionEnd:node.endIndex,
    ...(body ? {bodyStart:body.startIndex,bodyEnd:body.endIndex} : {}) };
};
export const phpGrammarMetadata = (node,text) => {
  if (!['function_definition','method_declaration'].includes(node.type)) return {};
  const params = [], paramTypes = {}, paramDefaults = {};
  for (const parameter of named(field(node,'parameters'))) {
    const name = source(field(parameter,'name'),text).replace(/^\$/,'');
    if (!name) continue;
    params.push(name);
    const type = source(field(parameter,'type'),text); if (type) paramTypes[name] = type;
    const value = source(field(parameter,'default_value'),text); if (value) paramDefaults[name] = value;
  }
  const modifiers = named(node).filter(child => /_modifier$/.test(child.type)).map(child=>source(child,text).trim());
  let visibility = modifiers.find(value=>['public','private','protected'].includes(value));
  if (!visibility && node.type === 'method_declaration') { visibility = 'public'; modifiers.push('public'); }
  const returnType = source(field(node,'return_type'),text) || null;
  const attributes = named(field(node,'attributes')).map(child=>source(child,text));
  return { params,paramTypes,paramDefaults,modifiers,visibility:visibility || null,returnType,returns:returnType,attributes,
    bodyless:!field(node,'body') };
};
export const rubyGrammarMetadata = (node,text) => {
  if (!['method','singleton_method'].includes(node.type)) return {};
  const params = [];
  for (const parameter of named(field(node,'parameters'))) {
    const name = parameter.type === 'identifier' ? source(parameter,text)
      : source(field(parameter,'name') || named(parameter).find(child=>child.type === 'identifier'),text);
    if (name) params.push(name);
  }
  return {params,bodyless:!field(node,'body'),...(node.type === 'singleton_method'
    ? {receiver:source(field(node,'object'),text),memberRole:'singleton'} : {memberRole:'instance'})};
};
export const resolveRubyQualifiedName = (node,name,scopes,text) => {
  if (node.type !== 'singleton_method') return null;
  const receiver = source(field(node,'object'),text);
  const lexical = [...scopes].reverse().map(scope=>scope.name).join('.');
  if (receiver === 'self') return `${lexical ? `${lexical}.` : ''}self.${name}`;
  const owner = /^[A-Za-z_][A-Za-z0-9_:]*$/.test(receiver) ? receiver.replace(/::/g,'.') : `receiver@${node.startIndex}`;
  return `${owner}.self.${name}`;
};
export const resolveScalaName = (node,text) => {
  if (node.type === 'extension_definition') {
    const types = source(field(node,'type_parameters'),text), parameters = node.childrenForFieldName?.('parameters') || [];
    return `extension${types}${parameters.map(item=>source(item,text)).join('')}`;
  }
  if (node.type === 'given_definition' && !field(node,'name')) {
    const parts = node.childrenForFieldName?.('return_type') || [];
    return `given:${parts.filter(part=>!['with_template_body','indented_block','with',':'].includes(part.type)).map(part=>source(part,text)).join('')}`;
  }
  return null;
};

const rAssignment = node => {
  let value = node, parent = node.parent;
  while (parent?.type === 'parenthesized_expression') {value=parent;parent=parent.parent;}
  if (parent?.type !== 'binary_operator') return null;
  const rhs = field(parent,'rhs'), operator = field(parent,'operator')?.type;
  return ['<-','<<-','='].includes(operator) && rhs?.startIndex === value.startIndex && rhs?.endIndex === value.endIndex
    ? parent : null;
};
export const resolveRName = (node,text) => {
  const assignment = rAssignment(node), target = field(assignment,'lhs');
  if (target?.type === 'identifier') return source(target,text).replace(/^`|`$/g,'').replace(/\\`/g,'`');
  // The grammar's function-definition name field is a keyword, not a binding.
  return `anonymous@${node.startIndex}`;
};
export const resolveRRange = node => {
  const assignment = rAssignment(node);
  return assignment ? {start:assignment.startIndex,end:assignment.endIndex} : null;
};
