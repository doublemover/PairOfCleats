import path from 'node:path';
import { toPosix } from '../../../shared/files.js';
import { listFilesInDir, resolveFromLookup } from './lookup.js';
import { normalizeRelPath } from './path-utils.js';

const PYTHON_MODULE_EXTENSIONS = ['.py', '.pyi'];
const PYTHON_PACKAGE_SUFFIXES = ['__init__.py', '__init__.pyi'];

const CLIKE_IMPORTER_EXTS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.h',
  '.hh',
  '.hpp',
  '.hxx',
  '.ipp',
  '.inl',
  '.inc',
  '.m',
  '.mm'
]);

const PATH_LIKE_IMPORTER_EXTS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.h',
  '.hh',
  '.hpp',
  '.hxx',
  '.ipp',
  '.inl',
  '.inc',
  '.m',
  '.mm',
  '.cmake',
  '.mk',
  '.mak',
  '.nix',
  '.proto',
  '.graphql',
  '.gql',
  '.hbs',
  '.mustache',
  '.jinja',
  '.jinja2',
  '.j2',
  '.bzl',
  '.star',
  '.dart'
]);

const PATH_LIKE_SPEC_EXTS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.h',
  '.hh',
  '.hpp',
  '.hxx',
  '.ipp',
  '.inl',
  '.inc',
  '.cmake',
  '.mk',
  '.nix',
  '.proto',
  '.graphql',
  '.gql',
  '.hbs',
  '.mustache',
  '.jinja',
  '.jinja2',
  '.j2',
  '.bzl',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.xml',
  '.md',
  '.txt',
  '.css',
  '.scss',
  '.js',
  '.ts',
  '.rb',
  '.py',
  '.php',
  '.pm',
  '.lua',
  '.sh'
]);

const resolveFromCandidateList = (candidates, lookup) => {
  const seen = new Set();
  for (const candidate of candidates) {
    const rel = normalizeRelPath(candidate);
    if (!rel || rel.startsWith('/') || seen.has(rel)) continue;
    seen.add(rel);
    const resolved = resolveFromLookup(rel, lookup);
    if (resolved) return resolved;
  }
  return null;
};

const resolveWithLanguageExtensions = ({ base, lookup, extensions = [], suffixes = [] }) => {
  const normalizedBase = normalizeRelPath(base);
  if (!normalizedBase || normalizedBase.startsWith('/')) return null;
  const candidates = [normalizedBase];
  for (const ext of extensions) {
    if (!ext) continue;
    candidates.push(`${normalizedBase}${ext}`);
  }
  for (const suffix of suffixes) {
    if (!suffix) continue;
    candidates.push(`${normalizedBase}/${suffix}`);
  }
  return resolveFromCandidateList(candidates, lookup);
};

const resolveWithLanguageExtensionsFromBases = ({
  bases,
  lookup,
  extensions = [],
  suffixes = []
}) => {
  if (!Array.isArray(bases) || !bases.length) return null;
  for (const base of bases) {
    const resolved = resolveWithLanguageExtensions({ base, lookup, extensions, suffixes });
    if (resolved) return resolved;
  }
  return null;
};

const resolveRubyLoadPathImport = ({ spec, lookup }) => {
  const normalizedSpec = normalizeRelPath(spec);
  if (!normalizedSpec || normalizedSpec.startsWith('/')) return null;
  const candidates = [
    normalizedSpec,
    `${normalizedSpec}.rb`,
    `${normalizedSpec}.rake`,
    `${normalizedSpec}/index.rb`,
    `${normalizedSpec}/index.rake`,
    `lib/${normalizedSpec}`,
    `lib/${normalizedSpec}.rb`,
    `lib/${normalizedSpec}.rake`,
    `lib/${normalizedSpec}/index.rb`,
    `lib/${normalizedSpec}/index.rake`
  ];
  return resolveFromCandidateList(candidates, lookup);
};

const resolveRubyRelativeImport = ({ base, lookup }) => {
  const normalizedBase = normalizeRelPath(base);
  if (!normalizedBase || normalizedBase.startsWith('/')) return null;
  const candidates = [
    normalizedBase,
    `${normalizedBase}.rb`,
    `${normalizedBase}.rake`,
    `${normalizedBase}/index.rb`,
    `${normalizedBase}/index.rake`
  ];
  return resolveFromCandidateList(candidates, lookup);
};

const isCmakeImporter = (importerInfo) => {
  if (importerInfo.extension === '.cmake') return true;
  return importerInfo.baseName === 'cmakelists.txt';
};

const expandPathLikeCandidates = ({ importerInfo, candidates }) => {
  const cmakeImporter = isCmakeImporter(importerInfo);
  const out = [];
  const seen = new Set();
  const pushCandidate = (candidate) => {
    const normalized = normalizeRelPath(candidate);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };
  for (const candidate of candidates || []) {
    if (candidate === null || candidate === undefined) continue;
    const normalized = normalizeRelPath(candidate);
    if (normalized) pushCandidate(normalized);
    if (!cmakeImporter) continue;
    const base = normalized || '';
    const hasExtension = Boolean(path.posix.extname(path.posix.basename(base)));
    if (hasExtension) continue;
    const cmakeListsPath = base ? `${base}/CMakeLists.txt` : 'CMakeLists.txt';
    pushCandidate(cmakeListsPath);
  }
  return out;
};

const looksLikePathSpecifier = (spec) => {
  if (!spec) return false;
  if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) return true;
  if (spec.startsWith('//') || spec.startsWith(':')) return true;
  if (spec.includes('/') || spec.includes('\\')) return true;
  const ext = path.posix.extname(spec).toLowerCase();
  return PATH_LIKE_SPEC_EXTS.has(ext);
};

const resolvePathLikeImport = ({ spec, importerInfo, lookup }) => {
  const rawSpec = toPosix(String(spec || '')).trim();
  if (!rawSpec) return null;
  if (rawSpec.startsWith('//')) {
    const label = rawSpec.slice(2);
    const colon = label.indexOf(':');
    if (colon >= 0) {
      const pkg = normalizeRelPath(label.slice(0, colon));
      const target = normalizeRelPath(label.slice(colon + 1));
      if (target) {
        return resolveFromCandidateList(
          expandPathLikeCandidates({
            importerInfo,
            candidates: [pkg ? `${pkg}/${target}` : target]
          }),
          lookup
        );
      }
      return null;
    }
    const normalizedLabel = normalizeRelPath(label);
    if (!normalizedLabel) return null;
    return resolveFromCandidateList(
      expandPathLikeCandidates({ importerInfo, candidates: [normalizedLabel] }),
      lookup
    );
  }
  if (rawSpec.startsWith(':')) {
    const target = normalizeRelPath(rawSpec.slice(1));
    if (!target) return null;
    return resolveFromCandidateList(
      expandPathLikeCandidates({ importerInfo, candidates: [`${importerInfo.importerDir}/${target}`] }),
      lookup
    );
  }
  if (rawSpec.startsWith('/')) {
    const normalizedSpec = normalizeRelPath(rawSpec);
    if (!normalizedSpec) return null;
    return resolveFromCandidateList(
      expandPathLikeCandidates({ importerInfo, candidates: [normalizedSpec.slice(1)] }),
      lookup
    );
  }
  if (rawSpec.startsWith('./') || rawSpec.startsWith('../')) {
    const joined = normalizeRelPath(path.posix.join(importerInfo.importerDir, rawSpec));
    return resolveFromCandidateList(
      expandPathLikeCandidates({ importerInfo, candidates: [joined] }),
      lookup
    );
  }
  const normalizedSpec = normalizeRelPath(rawSpec);
  if (!normalizedSpec) return null;
  if (normalizedSpec.startsWith('.')) {
    return resolveFromCandidateList(
      expandPathLikeCandidates({
        importerInfo,
        candidates: [path.posix.join(importerInfo.importerDir, normalizedSpec)]
      }),
      lookup
    );
  }
  return resolveFromCandidateList(
    expandPathLikeCandidates({
      importerInfo,
      candidates: [
        path.posix.join(importerInfo.importerDir, normalizedSpec),
        normalizedSpec
      ]
    }),
    lookup
  );
};

const resolvePythonRelativeDottedImport = ({ spec, importerInfo, lookup }) => {
  const match = spec.match(/^(\.+)(.*)$/);
  if (!match) return null;
  const dotPrefix = match[1] || '';
  const remainderRaw = match[2] || '';
  let anchorDir = importerInfo.importerDir;
  const climbs = Math.max(0, dotPrefix.length - 1);
  for (let i = 0; i < climbs; i += 1) {
    anchorDir = path.posix.dirname(anchorDir);
  }
  const remainder = remainderRaw
    ? normalizeRelPath(remainderRaw.replace(/\./g, '/'))
    : '';
  const base = remainder ? path.posix.join(anchorDir, remainder) : anchorDir;
  return resolveWithLanguageExtensions({
    base,
    lookup,
    extensions: PYTHON_MODULE_EXTENSIONS,
    suffixes: PYTHON_PACKAGE_SUFFIXES
  });
};

const resolveDottedImportToPath = ({ spec, lookup, extensions = [], prefixes = [''] }) => {
  if (!spec || spec.endsWith('.*')) return null;
  const normalizedSpec = spec.replace(/\\/g, '.');
  if (!/^[A-Za-z_][\w.]*$/.test(normalizedSpec)) return null;
  const parts = normalizedSpec.split('.').filter(Boolean);
  if (!parts.length) return null;
  const candidates = [];
  for (let keep = parts.length; keep >= 1; keep -= 1) {
    const stem = parts.slice(0, keep).join('/');
    for (const prefix of prefixes) {
      const base = prefix ? `${prefix}/${stem}` : stem;
      for (const ext of extensions) {
        candidates.push(`${base}${ext}`);
      }
    }
  }
  return resolveFromCandidateList(candidates, lookup);
};

const normalizeDottedImportSpecifier = (spec) => {
  if (!spec) return '';
  let normalized = String(spec).trim();
  normalized = normalized.replace(/\.\*$/, '').replace(/\._$/, '');
  normalized = normalized.replace(/:+$/, '');
  if (!normalized) return '';
  if (!/^[A-Za-z_][\w.]*$/.test(normalized)) return '';
  return normalized;
};

const resolveClikeIncludeImport = ({ spec, importerInfo, lookup }) => {
  const pathLikeResolved = resolvePathLikeImport({ spec, importerInfo, lookup });
  if (pathLikeResolved) return pathLikeResolved;
  const normalizedSpec = normalizeRelPath(spec);
  if (!normalizedSpec) return null;
  if (
    normalizedSpec.startsWith('/')
    || normalizedSpec.startsWith('.')
    || normalizedSpec.startsWith(':')
    || normalizedSpec.startsWith('//')
  ) {
    return null;
  }
  const includeRoots = ['include', 'src', 'lib', 'headers', 'vendor', 'third_party', 'third-party'];
  const baseCandidates = includeRoots.map((root) => `${root}/${normalizedSpec}`);
  const rooted = resolveFromCandidateList(baseCandidates, lookup);
  if (rooted) return rooted;
  if (path.posix.extname(normalizedSpec)) return null;
  return resolveWithLanguageExtensionsFromBases({
    bases: baseCandidates,
    lookup,
    extensions: ['.h', '.hpp', '.hh', '.hxx', '.inc', '.inl']
  });
};

const resolveDartPackageImport = ({ spec, lookup, dartPackageName }) => {
  if (!spec.startsWith('package:')) return null;
  const payload = spec.slice('package:'.length);
  if (!payload) return null;
  const slashIndex = payload.indexOf('/');
  const packageName = (slashIndex >= 0 ? payload.slice(0, slashIndex) : payload).trim();
  const packagePath = normalizeRelPath(slashIndex >= 0 ? payload.slice(slashIndex + 1) : '');
  if (!packageName || !packagePath) return null;
  const candidates = [
    `packages/${packageName}/${packagePath}`,
    `third_party/dart/${packageName}/${packagePath}`
  ];
  if (!dartPackageName || packageName === dartPackageName) {
    candidates.unshift(`lib/${packagePath}`, packagePath, `src/${packagePath}`);
  }
  return resolveFromCandidateList(candidates, lookup);
};

const resolveDartImport = ({ spec, importerInfo, lookup, dartPackageName }) => {
  if (spec.startsWith('dart:')) return null;
  const packageResolved = resolveDartPackageImport({ spec, lookup, dartPackageName });
  if (packageResolved) return packageResolved;
  if (!looksLikePathSpecifier(spec)) return null;
  const pathLikeResolved = resolvePathLikeImport({ spec, importerInfo, lookup });
  if (pathLikeResolved) return pathLikeResolved;
  const normalizedSpec = normalizeRelPath(spec);
  if (!normalizedSpec || normalizedSpec.startsWith('/')) return null;
  const bases = [
    path.posix.join(importerInfo.importerDir, normalizedSpec),
    normalizedSpec,
    `lib/${normalizedSpec}`,
    `src/${normalizedSpec}`
  ];
  return resolveWithLanguageExtensionsFromBases({
    bases,
    lookup,
    extensions: ['.dart']
  });
};

export const classifyImporter = (importerRel) => {
  const importerPath = normalizeRelPath(importerRel);
  const extension = path.posix.extname(importerPath).toLowerCase();
  const baseName = path.posix.basename(importerPath).toLowerCase();
  const importerDir = path.posix.dirname(importerPath);

  const isRuby = importerPath.endsWith('.rb') || importerPath.endsWith('.rake') || baseName === 'rakefile';
  const isPython = extension === '.py';
  const isPerl = extension === '.pl' || extension === '.pm' || extension === '.t';
  const isLua = extension === '.lua';
  const isPhp = extension === '.php';
  const isGo = extension === '.go';
  const isJava = extension === '.java';
  const isKotlin = extension === '.kt' || extension === '.kts';
  const isCsharp = extension === '.cs';
  const isSwift = extension === '.swift';
  const isRust = extension === '.rs';
  const isDart = extension === '.dart';
  const isScala = extension === '.scala';
  const isGroovy = extension === '.groovy' || extension === '.gradle';
  const isJulia = extension === '.jl';
  const isShell = extension === '.sh'
    || extension === '.bash'
    || extension === '.zsh'
    || extension === '.ksh'
    || extension === '.fish'
    || baseName === 'bashrc'
    || baseName === 'zshrc';
  const isClike = CLIKE_IMPORTER_EXTS.has(extension);
  const isPathLike = PATH_LIKE_IMPORTER_EXTS.has(extension)
    || baseName === 'cmakelists.txt'
    || baseName === 'makefile'
    || baseName === 'dockerfile'
    || baseName.endsWith('.mk');

  return {
    importerRel: importerPath,
    importerDir,
    extension,
    baseName,
    isRuby,
    isPython,
    isPerl,
    isLua,
    isPhp,
    isGo,
    isJava,
    isKotlin,
    isCsharp,
    isSwift,
    isRust,
    isDart,
    isScala,
    isGroovy,
    isJulia,
    isShell,
    isClike,
    isPathLike
  };
};

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
