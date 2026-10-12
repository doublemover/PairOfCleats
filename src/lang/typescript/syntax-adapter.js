/** Explicit compiler AST child fields, in compiler preorder. No metadata or parent traversal. */
const groups = {
  'SourceFile Block ModuleBlock': 'statements',
  'VariableStatement': 'modifiers declarationList',
  'VariableDeclarationList': 'declarations',
  'VariableDeclaration Parameter BindingElement': 'modifiers dotDotDotToken propertyName name questionToken exclamationToken type initializer',
  'ObjectBindingPattern ArrayBindingPattern': 'elements',
  'FunctionDeclaration FunctionExpression ArrowFunction MethodDeclaration MethodSignature Constructor GetAccessor SetAccessor': 'modifiers asteriskToken name questionToken typeParameters parameters type equalsGreaterThanToken body',
  'ClassDeclaration ClassExpression InterfaceDeclaration': 'modifiers name typeParameters heritageClauses members',
  'PropertyDeclaration PropertySignature': 'modifiers name questionToken exclamationToken type initializer',
  'TypeAliasDeclaration': 'modifiers name typeParameters type',
  'EnumDeclaration': 'modifiers name members',
  'EnumMember': 'name initializer',
  'ModuleDeclaration': 'modifiers name body',
  'HeritageClause': 'types',
  'ExpressionWithTypeArguments': 'expression typeArguments',
  'TypeParameter': 'modifiers name constraint default',
  'CallExpression NewExpression': 'expression questionDotToken typeArguments arguments',
  'TaggedTemplateExpression': 'tag questionDotToken typeArguments template',
  'PropertyAccessExpression': 'expression questionDotToken name',
  'ElementAccessExpression': 'expression questionDotToken argumentExpression',
  'BinaryExpression': 'left operatorToken right',
  'PrefixUnaryExpression PostfixUnaryExpression DeleteExpression TypeOfExpression VoidExpression AwaitExpression NonNullExpression ParenthesizedExpression': 'expression',
  'YieldExpression': 'asteriskToken expression',
  'ConditionalExpression': 'condition questionToken whenTrue colonToken whenFalse',
  'AsExpression SatisfiesExpression TypeAssertionExpression': 'expression type',
  'ObjectLiteralExpression': 'properties',
  'ArrayLiteralExpression': 'elements',
  'PropertyAssignment': 'name initializer',
  'ShorthandPropertyAssignment': 'name equalsToken objectAssignmentInitializer',
  'SpreadAssignment SpreadElement': 'expression',
  'ComputedPropertyName': 'expression',
  'ExpressionStatement ReturnStatement ThrowStatement': 'expression',
  'IfStatement': 'expression thenStatement elseStatement',
  'WhileStatement DoStatement': 'expression statement',
  'ForStatement': 'initializer condition incrementor statement',
  'ForInStatement ForOfStatement': 'awaitModifier initializer expression statement',
  'SwitchStatement': 'expression caseBlock',
  'CaseBlock': 'clauses',
  'CaseClause': 'expression statements',
  'DefaultClause': 'statements',
  'TryStatement': 'tryBlock catchClause finallyBlock',
  'CatchClause': 'variableDeclaration block',
  'LabeledStatement': 'label statement',
  'BreakStatement ContinueStatement': 'label',
  'WithStatement': 'expression statement',
  'ImportDeclaration': 'modifiers importClause moduleSpecifier attributes',
  'ImportClause': 'name namedBindings',
  'NamespaceImport NamespaceExport': 'name',
  'NamedImports NamedExports': 'elements',
  'ImportSpecifier ExportSpecifier': 'propertyName name',
  'ExportDeclaration': 'modifiers exportClause moduleSpecifier attributes',
  'ExportAssignment': 'modifiers expression',
  'ImportEqualsDeclaration': 'modifiers name moduleReference',
  'ExternalModuleReference': 'expression',
  'ImportAttributes AssertClause': 'elements',
  'ImportAttribute AssertEntry': 'name value',
  'TemplateExpression': 'head templateSpans',
  'TemplateSpan': 'expression literal',
  'TypeReference': 'typeName typeArguments',
  'QualifiedName': 'left right',
  'UnionType IntersectionType TupleType': 'types elements',
  'ArrayType OptionalType RestType ParenthesizedType': 'type',
  'TypeLiteral': 'members',
  'FunctionType ConstructorType CallSignature ConstructSignature IndexSignature': 'modifiers typeParameters parameters type',
  'TypeQuery': 'exprName typeArguments',
  'TypeOperator': 'type',
  'IndexedAccessType': 'objectType indexType',
  'ConditionalType': 'checkType extendsType trueType falseType',
  'InferType': 'typeParameter',
  'LiteralType': 'literal',
  'MappedType': 'readonlyToken typeParameter nameType questionToken type members',
  'NamedTupleMember': 'dotDotDotToken name questionToken type',
  'TypePredicate': 'assertsModifier parameterName type',
  'ImportType': 'argument attributes qualifier typeArguments',
  'Decorator': 'expression',
  'JsxElement': 'openingElement children closingElement',
  'JsxSelfClosingElement JsxOpeningElement': 'tagName typeArguments attributes',
  'JsxClosingElement': 'tagName',
  'JsxFragment': 'openingFragment children closingFragment',
  'JsxAttributes': 'properties',
  'JsxAttribute': 'name initializer',
  'JsxSpreadAttribute JsxExpression': 'dotDotDotToken expression',
  'JsxNamespacedName': 'namespace name',
  'ClassStaticBlockDeclaration': 'body'
};
export const TYPESCRIPT_CHILD_FIELDS = Object.freeze(Object.fromEntries(Object.entries(groups)
  .flatMap(([kinds, fields]) => kinds.split(' ').map((kind) => [kind, fields.split(' ')]))));
const kindNames = new WeakMap();
export const typeScriptKindName = (ts, node) => {
  // Reverse enum names include aliases (FirstStatement, etc.); use stable canonical names.
  let names = kindNames.get(ts);
  if (!names) {
    const leaves = ['Identifier', 'PrivateIdentifier', 'NumericLiteral', 'BigIntLiteral', 'StringLiteral',
      'RegularExpressionLiteral', 'NoSubstitutionTemplateLiteral', 'TemplateHead', 'TemplateMiddle', 'TemplateTail',
      'OmittedExpression', 'JsxText', 'JsxOpeningFragment', 'JsxClosingFragment', 'EndOfFileToken'];
    names = new Map([...Object.keys(TYPESCRIPT_CHILD_FIELDS), ...leaves]
      .filter((name) => typeof ts.SyntaxKind[name] === 'number').map((name) => [ts.SyntaxKind[name], name]));
    kindNames.set(ts, names);
  }
  return names.get(node.kind) || ts.SyntaxKind[node.kind];
};
export const TYPESCRIPT_STRUCTURAL_SLOTS = Object.freeze(Object.entries(TYPESCRIPT_CHILD_FIELDS)
  .flatMap(([kind, fields]) => fields.map((field) => `ast:${kind}.${field}`)).sort());
