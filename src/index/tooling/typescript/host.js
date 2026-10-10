import path from 'node:path';

const resolveScriptKind = (ts, fileName) => {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.mts') return ts.ScriptKind.TS;
  if (ext === '.cts') return ts.ScriptKind.TS;
  if (ext === '.mjs') return ts.ScriptKind.JS;
  if (ext === '.cjs') return ts.ScriptKind.JS;
  if (ext === '.js') return ts.ScriptKind.JS;
  if (ext === '.ts') return ts.ScriptKind.TS;
  return ts.ScriptKind.Unknown;
};

export const createVirtualCompilerHost = (ts, compilerOptions, vfsMap, sourcePaths = new Map(), moduleOrigins = sourcePaths) => {
  const baseHost = ts.createCompilerHost(compilerOptions, true);
  const useCaseSensitive = ts.sys.useCaseSensitiveFileNames;
  const canonicalize = (fileName) => {
    const resolved = path.resolve(fileName);
    return useCaseSensitive ? resolved : resolved.toLowerCase();
  };
  const getVfs = (fileName) => vfsMap.get(canonicalize(fileName));

  const fileExists = (fileName) => {
    if (getVfs(fileName) != null) return true;
    return baseHost.fileExists(fileName);
  };

  const readFile = (fileName) => {
    const hit = getVfs(fileName);
    if (typeof hit === 'string') return hit;
    return baseHost.readFile(fileName);
  };

  const getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const hit = getVfs(fileName);
    if (typeof hit === 'string') {
      return ts.createSourceFile(
        fileName,
        hit,
        languageVersion,
        true,
        resolveScriptKind(ts, fileName)
      );
    }
    return baseHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };

  const virtualBySource = new Map();
  for (const [virtualPath, sourcePath] of sourcePaths) virtualBySource.set(canonicalize(sourcePath), virtualPath);
  const moduleHost = { ...baseHost, fileExists: filename => virtualBySource.has(canonicalize(filename)) || fileExists(filename),
    readFile: filename => getVfs(virtualBySource.get(canonicalize(filename)) || filename) ?? readFile(filename) };
  const resolveModuleNames = (moduleNames, containingFile) => moduleNames.map(name => {
    const sourceFile = moduleOrigins.get(canonicalize(containingFile)) || containingFile;
    const resolved = ts.resolveModuleName(name, sourceFile, compilerOptions, moduleHost).resolvedModule;
    if (!resolved) return undefined;
    const virtualPath = virtualBySource.get(canonicalize(resolved.resolvedFileName));
    return virtualPath ? { ...resolved, resolvedFileName: virtualPath } : resolved;
  });
  return {
    ...baseHost,
    resolveModuleNames,
    fileExists,
    readFile,
    getSourceFile,
    writeFile: () => {},
    getCanonicalFileName: (fileName) => canonicalize(fileName)
  };
};
