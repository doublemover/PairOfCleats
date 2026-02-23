import {
  looksLikePathSpecifier,
  PYTHON_MODULE_EXTENSIONS,
  PYTHON_PACKAGE_SUFFIXES,
  resolvePathLikeImport,
  resolvePythonRelativeDottedImport,
  resolveRubyRelativeImport,
  resolveWithLanguageExtensions
} from './common-paths.js';

/**
 * Resolve a relative/path-like specifier using language-aware extension and
 * package conventions.
 *
 * This function only resolves candidates that should map to repo-local files.
 *
 * @param {{spec:string,base:string,importerInfo:object,lookup:object}} input
 * @returns {string|null}
 */
export const resolveLanguageRelativeImport = ({ spec, base, importerInfo, lookup }) => {
  if (importerInfo.isRuby) {
    const rubyResolved = resolveRubyRelativeImport({ base, lookup });
    if (rubyResolved) return rubyResolved;
  }
  if (importerInfo.isPython) {
    if (/^\.+[^/\\]*$/.test(spec) && !spec.startsWith('./') && !spec.startsWith('../')) {
      const dottedResolved = resolvePythonRelativeDottedImport({ spec, importerInfo, lookup });
      if (dottedResolved) return dottedResolved;
      return null;
    }
    return resolveWithLanguageExtensions({
      base,
      lookup,
      extensions: PYTHON_MODULE_EXTENSIONS,
      suffixes: PYTHON_PACKAGE_SUFFIXES
    });
  }
  if (importerInfo.isPerl) {
    return resolveWithLanguageExtensions({ base, lookup, extensions: ['.pm'] });
  }
  if (importerInfo.isLua) {
    return resolveWithLanguageExtensions({
      base,
      lookup,
      extensions: ['.lua'],
      suffixes: ['init.lua']
    });
  }
  if (importerInfo.isPhp) {
    return resolveWithLanguageExtensions({ base, lookup, extensions: ['.php'] });
  }
  if (importerInfo.isShell) {
    if (looksLikePathSpecifier(spec)) {
      const pathLikeResolved = resolvePathLikeImport({ spec, importerInfo, lookup });
      if (pathLikeResolved) return pathLikeResolved;
    }
    return resolveWithLanguageExtensions({ base, lookup, extensions: ['.sh'] });
  }
  if (importerInfo.isRust) {
    return resolveWithLanguageExtensions({
      base,
      lookup,
      extensions: ['.rs'],
      suffixes: ['mod.rs']
    });
  }
  if (importerInfo.isGo) {
    return resolveWithLanguageExtensions({ base, lookup, extensions: ['.go'] });
  }
  if (importerInfo.isJava) {
    return resolveWithLanguageExtensions({ base, lookup, extensions: ['.java'] });
  }
  if (importerInfo.isKotlin) {
    return resolveWithLanguageExtensions({ base, lookup, extensions: ['.kt', '.kts', '.java'] });
  }
  if (importerInfo.isCsharp) {
    return resolveWithLanguageExtensions({ base, lookup, extensions: ['.cs'] });
  }
  if (importerInfo.isSwift) {
    return resolveWithLanguageExtensions({ base, lookup, extensions: ['.swift'] });
  }
  if (importerInfo.isPathLike && looksLikePathSpecifier(spec)) {
    return resolvePathLikeImport({ spec, importerInfo, lookup });
  }
  return null;
};
