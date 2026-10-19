import path from 'node:path';
const unavailable = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_DEPENDENCY_UNSEALED' });
const assertApis = ts => {
  for (const name of ['getModeForUsageLocation', 'getImpliedNodeFormatForFile', 'getDefaultResolutionModeForFileWorker',
    'getSetExternalModuleIndicator', 'isSourceFileJS', 'getIsolatedModules', 'getJSXRuntimeImport', 'getJSXImplicitImportBase', 'forEachDynamicImportOrRequireCall', 'createModuleResolutionCache', 'createTypeReferenceDirectiveResolutionCache'])
    if (typeof ts[name] !== 'function') throw unavailable('TypeScript resolution API unavailable: ' + name);
};
/** Same compiler resolver and occurrence modes for execution and dependency preflight. */
export const createModeAwareTypeScriptResolver = (ts, defaultOptions, moduleHost, { canonicalize, moduleOrigins, virtualBySource }) => {
  assertApis(ts);
  // TypeScript's package cache belongs to this compiler host only. Occurrence
  // mode queries otherwise re-read the same package scope for every import.
  // Preflight and execution each create fresh hosts backed by their sealed
  // systems; this cache cannot admit package authority into a later invocation.
  const moduleCache = ts.createModuleResolutionCache(process.cwd(), canonicalize, defaultOptions);
  const packageJsonInfoCache = moduleCache.getPackageJsonInfoCache();
  const typeCache = ts.createTypeReferenceDirectiveResolutionCache(process.cwd(), canonicalize, defaultOptions, packageJsonInfoCache);
  const impliedNodeFormatForFile = (fileName, options) =>
    ts.getImpliedNodeFormatForFile(fileName, packageJsonInfoCache, moduleHost, options);
  const optionsFor = (options, redirectedReference) => redirectedReference?.commandLine.options || options || defaultOptions;
  const originFor = file => moduleOrigins.get(canonicalize(file)) || file;
  const modeFileName = file => {
    const origin = originFor(file);
    // Embedded containers retain their directory/package authority and the virtual language extension.
    return path.extname(origin).toLowerCase() === path.extname(file).toLowerCase() ? origin : origin + path.extname(file);
  };
  const modeSource = (file, containingFile, options) => file ? { ...file,
    impliedNodeFormat: impliedNodeFormatForFile(modeFileName(containingFile), options) } : undefined;
  const modeForModule = (literal, containingFile, sourceFile, options = defaultOptions, redirectedReference) => {
    if (!sourceFile) throw unavailable('TypeScript module occurrence requires its containing SourceFile.');
    return ts.getModeForUsageLocation(modeSource(sourceFile, containingFile, optionsFor(options, redirectedReference)), literal, optionsFor(options, redirectedReference));
  };
  const modeForType = (reference, containingFile, sourceFile, options = defaultOptions, redirectedReference) =>
    (typeof reference === 'string' ? undefined : reference.resolutionMode)
    ?? (sourceFile ? ts.getDefaultResolutionModeForFileWorker(modeSource(sourceFile, containingFile, optionsFor(options, redirectedReference)), optionsFor(options, redirectedReference)) : undefined);
  const remap = (result, key) => {
    const resolved = result[key]; if (!resolved) return result;
    const virtual = virtualBySource.get(canonicalize(resolved.resolvedFileName));
    return virtual ? { ...result, [key]: { ...resolved, resolvedFileName: virtual } } : result;
  };
  const resolveModuleNameLiterals = (literals, containingFile, redirectedReference, options, containingSourceFile) => {
    const effective = optionsFor(options, redirectedReference);
    return literals.map(literal => remap(ts.resolveModuleName(literal.text, originFor(containingFile), effective, moduleHost,
      moduleCache, redirectedReference, modeForModule(literal, containingFile, containingSourceFile, effective, redirectedReference)), 'resolvedModule'));
  };
  const resolveTypeReferenceDirectiveReferences = (references, containingFile, redirectedReference, options, containingSourceFile) => {
    const effective = optionsFor(options, redirectedReference);
    return references.map(reference => remap(ts.resolveTypeReferenceDirective(typeof reference === 'string' ? reference : reference.fileName,
      containingFile ? originFor(containingFile) : undefined, effective, moduleHost, redirectedReference, typeCache,
      modeForType(reference, containingFile, containingSourceFile, effective, redirectedReference)), 'resolvedTypeReferenceDirective'));
  };
  return { modeFileName, modeForModule, modeForType, impliedNodeFormatForFile, resolveModuleNameLiterals, resolveTypeReferenceDirectiveReferences };
};

/** Explicit compiler child adapters, retaining import-type and JS JSDoc resolution-mode attributes. */
export const scanTypeScriptResolutionReferences = (ts, sourceFile, options) => {
  assertApis(ts);
  const modules = [], seen = new Set();
  const add = literal => { if (literal && ts.isStringLiteralLike(literal) && literal.text && !seen.has(literal)) { seen.add(literal); modules.push(literal); } };
  const synthetic = name => {
    const literal = ts.factory.createStringLiteral(name), declaration = ts.factory.createImportDeclaration(undefined, undefined, literal, undefined);
    literal.parent = declaration; declaration.parent = sourceFile; add(literal);
  };
  const isJavaScript = ts.isSourceFileJS(sourceFile);
  if (isJavaScript || !sourceFile.isDeclarationFile && (ts.getIsolatedModules(options) || ts.isExternalModule(sourceFile))) {
    if (options.importHelpers) synthetic('tslib');
    const jsx = ts.getJSXRuntimeImport(ts.getJSXImplicitImportBase(options, sourceFile), options); if (jsx) synthetic(jsx);
  }
  // The compiler itself scans dynamic/import-type/JSDoc usages without binding or a Program.
  ts.forEachDynamicImportOrRequireCall(sourceFile, true, true, (_node, literal) => add(literal));
  const pending = [...sourceFile.statements];
  while (pending.length) {
    const node = pending.pop();
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name) && ts.isExternalModule(sourceFile)) add(node.name);
    ts.forEachChild(node, child => { pending.push(child); });
  }
  return modules.sort((a,b) => a.pos - b.pos || a.end - b.end || a.text.localeCompare(b.text));
};

/** Parse one source for preflight; never allocate a compiler Program or perform binding. */
export const preflightTypeScriptSource = (ts, host, fileName, options, redirectedReference) => {
  assertApis(ts);
  if (typeof host.resolveModuleNameLiterals !== 'function' || typeof host.resolveTypeReferenceDirectiveReferences !== 'function' || !host.semanticResolution)
    throw unavailable('Mode-aware TypeScript host callbacks unavailable.');
  const effective = redirectedReference?.commandLine.options || options;
  const sourceFile = host.getSourceFile(fileName, { languageVersion: effective.target ?? ts.ScriptTarget.Latest,
    impliedNodeFormat: host.semanticResolution.impliedNodeFormatForFile(fileName, effective),
    setExternalModuleIndicator: ts.getSetExternalModuleIndicator(effective), jsDocParsingMode: ts.JSDocParsingMode.ParseAll });
  if (!sourceFile) return { sourceFile: null, modules: [], types: [], referencedFiles: [], libReferenceDirectives: [] };
  const literals = scanTypeScriptResolutionReferences(ts, sourceFile, effective);
  const resolved = host.resolveModuleNameLiterals(literals, fileName, redirectedReference, effective, sourceFile);
  const typeReferences = sourceFile.typeReferenceDirectives || [];
  const resolvedTypes = host.resolveTypeReferenceDirectiveReferences(typeReferences, fileName, redirectedReference, effective, sourceFile);
  return { sourceFile, modules: literals.map((literal,index) => ({ literal,
    mode: host.semanticResolution.modeForModule(literal, fileName, sourceFile, effective, redirectedReference), resolution: resolved[index] })),
  types: typeReferences.map((reference,index) => ({ reference,
    mode: host.semanticResolution.modeForType(reference, fileName, sourceFile, effective, redirectedReference), resolution: resolvedTypes[index] })),
  referencedFiles: sourceFile.referencedFiles || [], libReferenceDirectives: sourceFile.libReferenceDirectives || [] };
};
