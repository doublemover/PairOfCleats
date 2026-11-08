const importedName = specifier => {
  if (specifier.type === 'ImportDefaultSpecifier') return 'default';
  if (specifier.type === 'ImportNamespaceSpecifier') return '*';
  if (specifier.type !== 'ImportSpecifier') return null;
  const imported = specifier.imported;
  if (imported?.type === 'Identifier') return imported.name;
  if (['StringLiteral', 'Literal'].includes(imported?.type) && typeof imported.value === 'string') return imported.value;
  return null;
};

/** Copy only top-level static bindings from the caller's already owned syntax.
 * Unknown imported spellings still establish the module boundary. No AST,
 * binding/scope handles, dynamic imports or import-equals targets escape here.
 */
export const recordJsTsImportBindings = (node, parent, bindings, sourceOwned) => {
  if (!sourceOwned || node?.type !== 'ImportDeclaration' || parent?.type !== 'Program'
    || typeof node.source?.value !== 'string' || !Array.isArray(node.specifiers)) return;
  for (const specifier of node.specifiers) {
    const local = specifier?.local;
    if (local?.type !== 'Identifier' || typeof local.name !== 'string' || !local.name) continue;
    const typeOnly = ['type', 'typeof'].includes(node.importKind) || ['type', 'typeof'].includes(specifier.importKind);
    bindings[local.name] = Object.freeze({ imported: importedName(specifier), module: node.source.value,
      ...(typeOnly ? { typeOnly: true } : {}) });
  }
};
