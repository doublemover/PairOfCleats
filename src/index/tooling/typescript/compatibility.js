// 5.7.2 is the first stable 5.7 release. Official 5.6 compilers do not
// export forEachDynamicImportOrRequireCall, required by sealed preflight.
export const MIN_TYPESCRIPT_VERSION = '5.7.2';
const MINIMUM = MIN_TYPESCRIPT_VERSION.split('.').map(Number);
const FUNCTIONS = Object.freeze([
  'createCompilerHost', 'createProgram', 'createSourceFile', 'createModuleResolutionCache',
  'createTypeReferenceDirectiveResolutionCache', 'resolveModuleName', 'resolveTypeReferenceDirective',
  'readConfigFile', 'parseJsonConfigFileContent', 'flattenDiagnosticMessageText', 'forEachChild',
  'getModeForUsageLocation', 'getImpliedNodeFormatForFile', 'getDefaultResolutionModeForFileWorker',
  'getSetExternalModuleIndicator', 'getIsolatedModules', 'getJSXRuntimeImport', 'getJSXImplicitImportBase',
  'forEachDynamicImportOrRequireCall', 'isSourceFileJS', 'isArrowFunction', 'isClassDeclaration',
  'isConstructorDeclaration', 'isEnumDeclaration', 'isExportDeclaration', 'isExternalModule',
  'isExternalModuleReference', 'isFunctionDeclaration', 'isFunctionExpression', 'isIdentifier',
  'isImportDeclaration', 'isImportEqualsDeclaration', 'isInterfaceDeclaration', 'isLiteralTypeNode',
  'isMethodDeclaration', 'isModuleDeclaration', 'isNoSubstitutionTemplateLiteral', 'isNumericLiteral',
  'isParenthesizedTypeNode', 'isStringLiteral', 'isStringLiteralLike', 'isTemplateLiteralTypeNode',
  'isTypeAliasDeclaration', 'isTypeReferenceNode', 'isUnionTypeNode', 'isVariableDeclaration',
  'factory.createImportDeclaration', 'factory.createStringLiteral', 'sys.readFile', 'sys.fileExists'
]);
const ENUM_VALUES = Object.freeze([
  'JSDocParsingMode.ParseAll', 'JsxEmit.Preserve', 'ModuleKind.ESNext', 'ModuleResolutionKind.Node10',
  'ScriptKind.JS', 'ScriptKind.JSX', 'ScriptKind.TS', 'ScriptKind.TSX', 'ScriptKind.Unknown',
  'ScriptTarget.ES2020', 'ScriptTarget.Latest', 'SymbolFlags.Alias', 'SymbolFlags.TypeParameter',
  'SyntaxKind.AsyncKeyword', 'SyntaxKind.NeverKeyword', 'SyntaxKind.StringKeyword'
]);
const member = (compiler, name) => name.split('.').reduce((value, key) => value?.[key], compiler);

export const getTypeScriptCompatibility = compiler => {
  const version = String(compiler?.version || 'unknown');
  const parsed = /^(\d+)\.(\d+)\.(\d+)(?:\+[\w.-]+)?$/.exec(version);
  const parts = parsed?.slice(1).map(Number);
  const supportedVersion = Boolean(parts?.every(Number.isSafeInteger)
    && (parts[0] - MINIMUM[0] || parts[1] - MINIMUM[1] || parts[2] - MINIMUM[2]) >= 0);
  const missing = FUNCTIONS.filter(name => typeof member(compiler, name) !== 'function');
  missing.push(...ENUM_VALUES.filter(name => !Number.isInteger(member(compiler, name))));
  if (typeof compiler?.sys?.useCaseSensitiveFileNames !== 'boolean') missing.push('sys.useCaseSensitiveFileNames');
  return { ok: supportedVersion && !missing.length, version, minimumVersion: MIN_TYPESCRIPT_VERSION, missing };
};

export const assertTypeScriptCompatibility = (compiler, source = 'selected compiler') => {
  const result = getTypeScriptCompatibility(compiler);
  if (!result.ok) {
    throw Object.assign(new Error(`TypeScript ${result.version} at ${source} is incompatible: require >=${MIN_TYPESCRIPT_VERSION} and the compiler host/preflight APIs.${result.missing.length ? ` Missing: ${result.missing.join(', ')}.` : ''} Install a compatible compiler at this location or change tooling.typescript.resolveOrder; the selected compiler is not silently replaced.`), {
      code: 'ERR_SEMANTIC_DEPENDENCY_UNSEALED', reason: 'typescript_incompatible', compatibility: result, source
    });
  }
  return result;
};
