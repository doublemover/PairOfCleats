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

export const createVirtualCompilerHost = (ts, compilerOptions, vfsMap) => {
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

  return {
    ...baseHost,
    fileExists,
    readFile,
    getSourceFile,
    writeFile: () => {},
    getCanonicalFileName: (fileName) => canonicalize(fileName)
  };
};
