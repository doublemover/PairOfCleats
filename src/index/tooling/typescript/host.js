import path from 'node:path';
import { createModeAwareTypeScriptResolver } from './resolution.js';
import { createTypeScriptVirtualBySource } from './roots.js';
import { assertTypeScriptCompatibility } from './compatibility.js';

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

export const createVirtualCompilerHost = (ts, compilerOptions, vfsMap, sourcePaths = new Map(), moduleOrigins = sourcePaths, system = ts?.sys,
  reuse = null) => {
  assertTypeScriptCompatibility(ts);
  const baseHost = ts.createCompilerHost(compilerOptions, true);
  for (const method of ['fileExists', 'readFile', 'directoryExists', 'getDirectories', 'readDirectory', 'realpath']) {
    if (typeof system[method] === 'function') baseHost[method] = system[method];
  }
  const useCaseSensitive = ts.sys.useCaseSensitiveFileNames;
  const canonicalize = (fileName) => {
    const resolved = path.resolve(fileName);
    return useCaseSensitive ? resolved : resolved.toLowerCase();
  };
  const canonicalOrigins = new Map([...moduleOrigins].map(([virtualPath, origin]) => [canonicalize(virtualPath), origin]));
  const virtualBySource = createTypeScriptVirtualBySource(sourcePaths, canonicalize);
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
    const hit = readFile(fileName);
    if (typeof hit === 'string') {
      const filename = canonicalize(fileName), scriptKind = resolveScriptKind(ts, fileName);
      const reuseKey = reuse?.cache.identity({ ts, filename, text: hit, languageVersion, scriptKind,
        options: compilerOptions, mapping: { origins: [...canonicalOrigins].sort(), sources: [...sourcePaths].sort() } });
      // Dependency reads still happen above. A cache hit cannot bypass the
      // sealed resolver/system or a forced fresh SourceFile request.
      const cached = !shouldCreateNewSourceFile && reuseKey ? reuse.cache.get(reuseKey, filename, reuse.mode) : null;
      if (cached) return cached;
      const sourceFile = ts.createSourceFile(
        fileName,
        hit,
        languageVersion,
        true,
        scriptKind
      );
      // Triple-slash path references are processed by Program itself, outside
      // resolveModuleNameLiterals. Keep their physical container origin and
      // reuse exact whole-file VFS aliases just as module imports do.
      if (sourceFile.referencedFiles.length) {
        const origin = canonicalOrigins.get(canonicalize(fileName)) || fileName;
        sourceFile.referencedFiles = sourceFile.referencedFiles.map(reference => {
          const absolute = path.resolve(path.dirname(origin), reference.fileName);
          return { ...reference, fileName: virtualBySource.get(canonicalize(absolute)) || absolute };
        });
      }
      if (reuseKey) reuse.cache.put(reuseKey, filename, sourceFile, reuse.mode);
      return sourceFile;
    }
    return undefined;
  };

  const moduleHost = { ...baseHost, fileExists: filename => virtualBySource.has(canonicalize(filename)) || fileExists(filename),
    readFile: filename => getVfs(virtualBySource.get(canonicalize(filename)) || filename) ?? readFile(filename) };
  const resolver = createModeAwareTypeScriptResolver(ts, compilerOptions, moduleHost,
    { canonicalize, moduleOrigins: canonicalOrigins, virtualBySource });
  return {
    ...baseHost,
    resolveModuleNameLiterals: resolver.resolveModuleNameLiterals,
    resolveTypeReferenceDirectiveReferences: resolver.resolveTypeReferenceDirectiveReferences,
    semanticResolution: resolver,
    fileExists,
    readFile,
    getSourceFile,
    writeFile: () => {},
    getCanonicalFileName: (fileName) => canonicalize(fileName)
  };
};
