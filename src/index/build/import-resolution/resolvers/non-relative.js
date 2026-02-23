import path from 'node:path';
import { listFilesInDir } from '../lookup.js';
import { normalizeRelPath } from '../path-utils.js';
import {
  looksLikePathSpecifier,
  normalizeDottedImportSpecifier,
  resolveClikeIncludeImport,
  resolveDartImport,
  resolveDottedImportToPath,
  resolveFromCandidateList,
  resolvePathLikeImport,
  resolveRubyLoadPathImport
} from './common-paths.js';

/**
 * Resolve non-relative imports for language ecosystems with local module
 * conventions (Ruby load paths, Go module roots, Dart package imports, etc.).
 *
 * Unhandled specifiers are left to generic external classification upstream.
 *
 * @param {{
 *   importerInfo:object,
 *   spec:string,
 *   lookup:object,
 *   goModulePath?:string|null,
 *   dartPackageName?:string|null
 * }} input
 * @returns {{resolvedType:string,resolvedPath:string}|null}
 */
export const resolveLanguageNonRelativeImport = ({
  importerInfo,
  spec,
  lookup,
  goModulePath,
  dartPackageName
}) => {
  if (importerInfo.isRuby) {
    const rubyResolved = resolveRubyLoadPathImport({ spec, lookup });
    if (rubyResolved) return { resolvedType: 'ruby-load-path', resolvedPath: rubyResolved };
  }
  if (importerInfo.isPython) {
    if (/^[A-Za-z_][\w.]*$/.test(spec)) {
      const modulePath = spec.replace(/\./g, '/');
      const resolved = resolveFromCandidateList([
        `${modulePath}.py`,
        `${modulePath}.pyi`,
        `${modulePath}/__init__.py`,
        `${modulePath}/__init__.pyi`,
        path.posix.join(importerInfo.importerDir, `${modulePath}.py`),
        path.posix.join(importerInfo.importerDir, `${modulePath}.pyi`),
        path.posix.join(importerInfo.importerDir, `${modulePath}/__init__.py`),
        path.posix.join(importerInfo.importerDir, `${modulePath}/__init__.pyi`),
        `src/${modulePath}.py`,
        `src/${modulePath}.pyi`,
        `src/${modulePath}/__init__.py`,
        `src/${modulePath}/__init__.pyi`,
        `lib/${modulePath}.py`,
        `lib/${modulePath}.pyi`,
        `lib/${modulePath}/__init__.py`,
        `lib/${modulePath}/__init__.pyi`
      ], lookup);
      if (resolved) return { resolvedType: 'python-module', resolvedPath: resolved };
    }
    return null;
  }
  if (importerInfo.isPerl) {
    if (spec.includes('::')) {
      const packagePath = spec.replace(/::/g, '/');
      const resolved = resolveFromCandidateList([`${packagePath}.pm`, `lib/${packagePath}.pm`], lookup);
      if (resolved) return { resolvedType: 'perl-package', resolvedPath: resolved };
    }
    return null;
  }
  if (importerInfo.isLua) {
    if (/^[A-Za-z_][\w.]*$/.test(spec)) {
      const modulePath = spec.replace(/\./g, '/');
      const resolved = resolveFromCandidateList([
        `${modulePath}.lua`,
        `${modulePath}/init.lua`,
        `lua/${modulePath}.lua`,
        `lua/${modulePath}/init.lua`,
        `src/${modulePath}.lua`,
        `src/${modulePath}/init.lua`
      ], lookup);
      if (resolved) return { resolvedType: 'lua-module', resolvedPath: resolved };
    }
    return null;
  }
  if (importerInfo.isPhp) {
    if (spec.includes('\\')) {
      const namespacePath = spec.replace(/\\/g, '/');
      const resolved = resolveFromCandidateList([
        `${namespacePath}.php`,
        `src/${namespacePath}.php`,
        `app/${namespacePath}.php`,
        `lib/${namespacePath}.php`
      ], lookup);
      if (resolved) return { resolvedType: 'php-namespace', resolvedPath: resolved };
    }
    return null;
  }
  if (importerInfo.isShell) {
    if (looksLikePathSpecifier(spec)) {
      const resolved = resolvePathLikeImport({ spec, importerInfo, lookup });
      if (resolved) return { resolvedType: 'shell-path', resolvedPath: resolved };
    }
    return null;
  }
  if (importerInfo.isGo) {
    let packageRel = null;
    if (goModulePath && spec.startsWith(`${goModulePath}/`)) {
      packageRel = normalizeRelPath(spec.slice(goModulePath.length + 1));
    } else if (/^(internal|pkg|cmd|src)\//.test(spec)) {
      packageRel = normalizeRelPath(spec);
    }
    if (packageRel) {
      const direct = resolveFromCandidateList([`${packageRel}.go`, `src/${packageRel}.go`], lookup);
      if (direct) return { resolvedType: 'go-module', resolvedPath: direct };
      const dirCandidates = [
        ...listFilesInDir({ dir: packageRel, lookup, ext: '.go' }),
        ...listFilesInDir({ dir: `src/${packageRel}`, lookup, ext: '.go' })
      ];
      if (dirCandidates.length) return { resolvedType: 'go-module', resolvedPath: dirCandidates[0] };
    }
    return null;
  }
  if (importerInfo.isJava) {
    const resolved = resolveDottedImportToPath({
      spec,
      lookup,
      extensions: ['.java', '.kt'],
      prefixes: [
        '',
        'src',
        'app',
        'lib',
        'src/main/java',
        'src/test/java',
        'src/main/kotlin',
        'src/test/kotlin'
      ]
    });
    if (resolved) return { resolvedType: 'java-package', resolvedPath: resolved };
    return null;
  }
  if (importerInfo.isKotlin) {
    const resolved = resolveDottedImportToPath({
      spec,
      lookup,
      extensions: ['.kt', '.kts', '.java'],
      prefixes: [
        '',
        'src',
        'app',
        'lib',
        'src/main/kotlin',
        'src/test/kotlin',
        'src/main/java',
        'src/test/java'
      ]
    });
    if (resolved) return { resolvedType: 'kotlin-package', resolvedPath: resolved };
    return null;
  }
  if (importerInfo.isCsharp) {
    const resolved = resolveDottedImportToPath({
      spec,
      lookup,
      extensions: ['.cs'],
      prefixes: ['', 'src', 'app', 'lib']
    });
    if (resolved) return { resolvedType: 'csharp-namespace', resolvedPath: resolved };
    return null;
  }
  if (importerInfo.isSwift) {
    if (!/^[A-Za-z_][\w.]*$/.test(spec)) return null;
    const moduleName = spec.split('.')[0];
    const direct = resolveFromCandidateList([
      `Sources/${moduleName}/${moduleName}.swift`,
      `${moduleName}.swift`,
      `src/${moduleName}.swift`
    ], lookup);
    if (direct) return { resolvedType: 'swift-module', resolvedPath: direct };
    const inSources = listFilesInDir({ dir: `Sources/${moduleName}`, lookup, ext: '.swift' });
    if (inSources.length) return { resolvedType: 'swift-module', resolvedPath: inSources[0] };
    return null;
  }
  if (importerInfo.isDart) {
    const resolved = resolveDartImport({ spec, importerInfo, lookup, dartPackageName });
    if (resolved) return { resolvedType: 'dart-module', resolvedPath: resolved };
    return null;
  }
  if (importerInfo.isScala) {
    const normalizedSpec = normalizeDottedImportSpecifier(spec);
    if (!normalizedSpec) return null;
    const resolved = resolveDottedImportToPath({
      spec: normalizedSpec,
      lookup,
      extensions: ['.scala', '.java', '.kt'],
      prefixes: [
        '',
        'src/main/scala',
        'src/test/scala',
        'src/main/java',
        'src/test/java',
        'src/main/kotlin',
        'src/test/kotlin',
        'app',
        'lib',
        'src'
      ]
    });
    if (resolved) return { resolvedType: 'scala-package', resolvedPath: resolved };
    return null;
  }
  if (importerInfo.isGroovy) {
    const normalizedSpec = normalizeDottedImportSpecifier(spec);
    if (!normalizedSpec) return null;
    const resolved = resolveDottedImportToPath({
      spec: normalizedSpec,
      lookup,
      extensions: ['.groovy', '.java', '.kt'],
      prefixes: [
        '',
        'src/main/groovy',
        'src/test/groovy',
        'src/main/java',
        'src/test/java',
        'src/main/kotlin',
        'src/test/kotlin',
        'app',
        'lib',
        'src'
      ]
    });
    if (resolved) return { resolvedType: 'groovy-package', resolvedPath: resolved };
    return null;
  }
  if (importerInfo.isJulia) {
    const moduleSpec = String(spec || '').split(':')[0].trim();
    if (!moduleSpec || !/^[A-Za-z_][\w.]*$/.test(moduleSpec)) return null;
    const parts = moduleSpec.split('.').filter(Boolean);
    if (!parts.length) return null;
    const modulePath = parts.join('/');
    const moduleLeaf = parts[parts.length - 1];
    const resolved = resolveFromCandidateList([
      `src/${modulePath}.jl`,
      `src/${modulePath}/${moduleLeaf}.jl`,
      `${modulePath}.jl`,
      `${modulePath}/${moduleLeaf}.jl`,
      `test/${modulePath}.jl`
    ], lookup);
    if (resolved) return { resolvedType: 'julia-module', resolvedPath: resolved };
    return null;
  }
  if (importerInfo.isClike && looksLikePathSpecifier(spec)) {
    const resolved = resolveClikeIncludeImport({ spec, importerInfo, lookup });
    if (resolved) return { resolvedType: 'clike-include', resolvedPath: resolved };
    return null;
  }
  if (importerInfo.isRust) {
    if (!spec.includes('::')) return null;
    const parts = spec.split('::').filter(Boolean);
    if (!parts.length) return null;
    let baseDir = null;
    let tail = [];
    if (parts[0] === 'crate') {
      baseDir = 'src';
      tail = parts.slice(1);
    } else if (parts[0] === 'self') {
      baseDir = importerInfo.importerDir;
      tail = parts.slice(1);
    } else if (parts[0] === 'super') {
      baseDir = path.posix.dirname(importerInfo.importerDir);
      tail = parts.slice(1);
    } else {
      return null;
    }
    if (!tail.length) return null;
    const stem = path.posix.join(baseDir, tail.join('/'));
    const resolved = resolveFromCandidateList([`${stem}.rs`, `${stem}/mod.rs`], lookup);
    if (resolved) return { resolvedType: 'rust-module', resolvedPath: resolved };
    return null;
  }
  if (importerInfo.isPathLike && looksLikePathSpecifier(spec)) {
    const resolved = resolvePathLikeImport({ spec, importerInfo, lookup });
    if (resolved) return { resolvedType: 'path-like', resolvedPath: resolved };
  }
  return null;
};
