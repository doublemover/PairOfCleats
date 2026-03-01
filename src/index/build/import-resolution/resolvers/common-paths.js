import path from 'node:path';
import { toPosix } from '../../../../shared/files.js';
import { resolveFromLookup } from '../lookup.js';
import { normalizeRelPath } from '../path-utils.js';
import { parseBazelLabelSpecifier } from '../specifier-hints.js';

export const PYTHON_MODULE_EXTENSIONS = ['.py', '.pyi'];
export const PYTHON_PACKAGE_SUFFIXES = ['__init__.py', '__init__.pyi'];

export const CLIKE_IMPORTER_EXTS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.cppm',
  '.h',
  '.hh',
  '.hpp',
  '.hxx',
  '.def',
  '.ixx',
  '.ipp',
  '.inl',
  '.modulemap',
  '.inc',
  '.tpp',
  '.m',
  '.mm'
]);

export const PATH_LIKE_IMPORTER_EXTS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.cppm',
  '.h',
  '.hh',
  '.hpp',
  '.hxx',
  '.def',
  '.ixx',
  '.ipp',
  '.inl',
  '.modulemap',
  '.inc',
  '.tpp',
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
  '.dart',
  '.toml',
  '.bazel',
  '.html',
  '.htm'
]);

const PATH_LIKE_SPEC_EXTS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.cppm',
  '.h',
  '.hh',
  '.hpp',
  '.hxx',
  '.ixx',
  '.ipp',
  '.inl',
  '.modulemap',
  '.tpp',
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

export const resolveFromCandidateList = (candidates, lookup) => {
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

export const resolveWithLanguageExtensions = ({ base, lookup, extensions = [], suffixes = [] }) => {
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

export const resolveWithLanguageExtensionsFromBases = ({
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

export const resolveRubyLoadPathImport = ({ spec, lookup }) => {
  const normalizedSpec = normalizeRelPath(spec);
  if (!normalizedSpec || normalizedSpec.startsWith('/')) return null;
  const candidates = [
    normalizedSpec,
    `${normalizedSpec}.rb`,
    `${normalizedSpec}.rake`,
    `${normalizedSpec}.ru`,
    `${normalizedSpec}.gemspec`,
    `${normalizedSpec}/index.rb`,
    `${normalizedSpec}/index.rake`,
    `${normalizedSpec}/index.ru`,
    `lib/${normalizedSpec}`,
    `lib/${normalizedSpec}.rb`,
    `lib/${normalizedSpec}.rake`,
    `lib/${normalizedSpec}.ru`,
    `lib/${normalizedSpec}.gemspec`,
    `lib/${normalizedSpec}/index.rb`,
    `lib/${normalizedSpec}/index.rake`,
    `lib/${normalizedSpec}/index.ru`
  ];
  return resolveFromCandidateList(candidates, lookup);
};

export const resolveRubyRelativeImport = ({ base, lookup }) => {
  const normalizedBase = normalizeRelPath(base);
  if (!normalizedBase || normalizedBase.startsWith('/')) return null;
  const candidates = [
    normalizedBase,
    `${normalizedBase}.rb`,
    `${normalizedBase}.rake`,
    `${normalizedBase}.ru`,
    `${normalizedBase}.gemspec`,
    `${normalizedBase}/index.rb`,
    `${normalizedBase}/index.rake`,
    `${normalizedBase}/index.ru`
  ];
  return resolveFromCandidateList(candidates, lookup);
};

const isCmakeImporter = (importerInfo) => {
  if (importerInfo.extension === '.cmake') return true;
  return importerInfo.baseName === 'cmakelists.txt';
};

const isNixImporter = (importerInfo) => importerInfo?.extension === '.nix';

const isTomlImporter = (importerInfo) => {
  if (importerInfo?.extension === '.toml') return true;
  return importerInfo?.baseName === 'pipfile';
};

const expandPathLikeCandidates = ({ importerInfo, candidates }) => {
  const cmakeImporter = isCmakeImporter(importerInfo);
  const nixImporter = isNixImporter(importerInfo);
  const tomlImporter = isTomlImporter(importerInfo);
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
    if (!cmakeImporter && !nixImporter && !tomlImporter) continue;
    const base = normalized || '';
    const hasExtension = Boolean(path.posix.extname(path.posix.basename(base)));
    if (hasExtension) continue;
    // Directory-style imports map to conventional entry files per ecosystem.
    if (cmakeImporter) {
      const cmakeListsPath = base ? `${base}/CMakeLists.txt` : 'CMakeLists.txt';
      pushCandidate(cmakeListsPath);
    }
    if (nixImporter) {
      const defaultNixPath = base ? `${base}/default.nix` : 'default.nix';
      const flakeNixPath = base ? `${base}/flake.nix` : 'flake.nix';
      pushCandidate(defaultNixPath);
      pushCandidate(flakeNixPath);
    }
    if (tomlImporter) {
      const cargoTomlPath = base ? `${base}/Cargo.toml` : 'Cargo.toml';
      const pyprojectTomlPath = base ? `${base}/pyproject.toml` : 'pyproject.toml';
      const projectTomlPath = base ? `${base}/Project.toml` : 'Project.toml';
      pushCandidate(cargoTomlPath);
      pushCandidate(pyprojectTomlPath);
      pushCandidate(projectTomlPath);
    }
  }
  return out;
};

export const looksLikePathSpecifier = (spec) => {
  if (!spec) return false;
  if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) return true;
  if (spec.startsWith('//') || spec.startsWith(':')) return true;
  if (spec.includes('/') || spec.includes('\\')) return true;
  const ext = path.posix.extname(spec).toLowerCase();
  return PATH_LIKE_SPEC_EXTS.has(ext);
};

const resolveUnittestsProjectRootCandidate = ({ rawSpec, importerInfo }) => {
  if (typeof rawSpec !== 'string' || !rawSpec.startsWith('../')) return null;
  const importerRel = normalizeRelPath(importerInfo?.importerRel);
  if (!importerRel) return null;
  const parts = importerRel.split('/').filter(Boolean);
  const unittestsIndex = parts.indexOf('unittests');
  if (unittestsIndex <= 0) return null;
  const projectRoot = parts.slice(0, unittestsIndex).join('/');
  if (!projectRoot) return null;
  const strippedSpec = normalizeRelPath(rawSpec.replace(/^(?:\.\.\/)+/, ''));
  if (!strippedSpec || strippedSpec.startsWith('/')) return null;
  return normalizeRelPath(`${projectRoot}/${strippedSpec}`);
};

export const resolvePathLikeImport = ({ spec, importerInfo, lookup }) => {
  const rawSpec = toPosix(String(spec || '')).trim();
  if (!rawSpec) return null;
  const bazelSourceFile = importerInfo?.extension === '.bzl'
    || importerInfo?.extension === '.star'
    || importerInfo?.extension === '.bazel';
  const htmlSourceFile = importerInfo?.extension === '.html' || importerInfo?.extension === '.htm';
  const bazelLabel = parseBazelLabelSpecifier(rawSpec, { importerRel: importerInfo.importerRel });
  if (bazelLabel) {
    if (bazelLabel.repo) return null;
    const labelCandidates = [];
    const pushCandidate = (candidate) => {
      const normalized = normalizeRelPath(candidate);
      if (!normalized) return;
      if (!labelCandidates.includes(normalized)) labelCandidates.push(normalized);
    };
    const packageRel = normalizeRelPath(bazelLabel.package);
    const targetRel = normalizeRelPath(bazelLabel.target);
    if (targetRel) {
      pushCandidate(packageRel ? `${packageRel}/${targetRel}` : targetRel);
      if (bazelSourceFile && !path.posix.extname(path.posix.basename(targetRel))) {
        pushCandidate(packageRel ? `${packageRel}/${targetRel}.bzl` : `${targetRel}.bzl`);
      }
    }
    if (packageRel) {
      pushCandidate(packageRel);
      const packageBase = path.posix.basename(packageRel);
      if (packageBase) {
        pushCandidate(`${packageRel}/${packageBase}`);
        if (bazelSourceFile) {
          pushCandidate(`${packageRel}/${packageBase}.bzl`);
        }
      }
      if (bazelSourceFile) pushCandidate(`${packageRel}.bzl`);
    }
    return resolveFromCandidateList(
      expandPathLikeCandidates({ importerInfo, candidates: labelCandidates }),
      lookup
    );
  }
  if (rawSpec.startsWith('/')) {
    const normalizedSpec = normalizeRelPath(rawSpec);
    if (!normalizedSpec) return null;
    const absoluteTarget = normalizedSpec.slice(1);
    const importerAnchoredAbsolute = htmlSourceFile
      ? normalizeRelPath(path.posix.join(importerInfo.importerDir, absoluteTarget))
      : null;
    return resolveFromCandidateList(
      expandPathLikeCandidates({
        importerInfo,
        candidates: [importerAnchoredAbsolute, absoluteTarget]
      }),
      lookup
    );
  }
  if (rawSpec.startsWith('./') || rawSpec.startsWith('../')) {
    const joined = normalizeRelPath(path.posix.join(importerInfo.importerDir, rawSpec));
    const unittestsRootCandidate = resolveUnittestsProjectRootCandidate({ rawSpec, importerInfo });
    return resolveFromCandidateList(
      expandPathLikeCandidates({
        importerInfo,
        candidates: [joined, unittestsRootCandidate]
      }),
      lookup
    );
  }
  const normalizedSpec = normalizeRelPath(rawSpec);
  if (!normalizedSpec) return null;
  if (normalizedSpec.startsWith('.')) {
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

export const resolvePythonRelativeDottedImport = ({ spec, importerInfo, lookup }) => {
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

export const resolveDottedImportToPath = ({ spec, lookup, extensions = [], prefixes = [''] }) => {
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

export const normalizeDottedImportSpecifier = (spec) => {
  if (!spec) return '';
  let normalized = String(spec).trim();
  normalized = normalized.replace(/\.\*$/, '').replace(/\._$/, '');
  normalized = normalized.replace(/:+$/, '');
  if (!normalized) return '';
  if (!/^[A-Za-z_][\w.]*$/.test(normalized)) return '';
  return normalized;
};

export const resolveClikeIncludeImport = ({ spec, importerInfo, lookup }) => {
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
    extensions: ['.h', '.hpp', '.hh', '.hxx', '.inc', '.inl', '.ipp', '.tpp', '.ixx', '.cppm', '.modulemap']
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

export const resolveDartImport = ({ spec, importerInfo, lookup, dartPackageName }) => {
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
