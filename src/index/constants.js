import {
  LOCK_FILENAMES,
  MANIFEST_FILENAMES,
  MANIFEST_SUFFIXES,
  SPECIAL_CODE_FILENAME_TO_EXT,
  SPECIAL_CODE_FILENAMES,
  SPECIAL_CODE_PREFIX_TO_EXT
} from './language-registry/special-files.js';
import { LANGUAGE_ROUTE_DESCRIPTORS, getLanguageDescriptor } from './language-registry/descriptors.js';

export const SKIP_DIRS = new Set([
  '.git',
  '.repoMetrics',
  '.cache',
  '.gradle',
  '.idea',
  '.mypy_cache',
  '.next',
  '.nuxt',
  '.parcel-cache',
  '.pytest_cache',
  '.ruff_cache',
  '.svelte-kit',
  '.turbo',
  '.tox',
  '.venv',
  '.vite',
  '.vs',
  '.vscode',
  '__generated__',
  '__pycache__',
  '__pypackages__',
  'bazel-bin',
  'bazel-out',
  'bazel-testlogs',
  'buck-out',
  'build',
  'cmake-build-debug',
  'cmake-build-release',
  'coverage',
  'dist',
  'generated',
  'gen',
  'exports',
  'holiday93',
  'holiday94',
  'img',
  'index-code',
  'index-prose',
  'index-',
  'node_modules',
  'obj',
  'out',
  'storybook-static',
  'target',
  'temp',
  'tmp',
  'venv',
  'xmas91',
  'xmas92',
  'tools'
]);

export const SKIP_GLOBS = new Set([
  '**/*.min.js',
  '**/*.min.mjs',
  '**/*.min.cjs',
  '**/*.min.css',
  '**/*.min.js.map',
  '**/*.min.css.map',
  '**/*.min.map',
  '**/*.bundle.js',
  '**/*.bundle.css',
  '**/*.bundle.js.map',
  '**/*.bundle.css.map',
  '**/*.d.ts',
  '**/*.d.mts',
  '**/*.d.cts',
  '**/*.d.ts.map',
  '**/*.d.mts.map',
  '**/*.d.cts.map',
  '**/*.tsbuildinfo',
  '**/*.gen.ts',
  '**/*.gen.tsx',
  '**/*.g.ts',
  '**/*.g.tsx',
  '**/*.generated.ts',
  '**/*.generated.tsx',
  '**/*.generated.*',
  '**/*_generated.*',
  '**/*-generated.*',
  '**/*-min.js',
  '**/*-min.css',
  'cmake-build*/'
]);

export const SKIP_FILES = new Set([
  '.eslint.config.js',
  '.gitattributes',
  '.gitignore',
  '.jshintconfig',
  '.jshintignore',
  '.pairofcleats.json',
  '.pairofcleatsignore',
  '.scannedfiles',
  '.scannedfiles.json',
  '.searchhistory',
  '.skippedfiles',
  '.skippedfiles.json',
  '.filelists.json',
  'bash_aliases',
  'char3_postings.json',
  'chunk_meta.json',
  'dense_vectors',
  'fileformat.txt',
  'jquery.js',
  'metrics.json',
  '.repoMetrics.old',
  '.repoMetrics0.old',
  '.repoMetrics1.old',
  'noResultQueries',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'composer.lock',
  'Pipfile.lock',
  'searchHistory',
  'site.webmanifest',
  'sparse_postings.json',
  'webmidi.js',
  'wordInfo.json',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'words_alpha.txt',
  'AGENTS.md'
]);

export const MANIFEST_FILES = new Set(MANIFEST_FILENAMES);

export const LOCK_FILES = new Set(LOCK_FILENAMES);

export const EXTS_PROSE = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc', '.asciidoc']);

const extensionsFor = (id) => new Set(getLanguageDescriptor(id)?.extensions || []);

const CODE_EXTENSION_SET = new Set();
for (const descriptor of LANGUAGE_ROUTE_DESCRIPTORS) {
  for (const ext of descriptor?.extensions || []) {
    CODE_EXTENSION_SET.add(ext);
  }
}
for (const ext of ['.def', '.vue', '.svelte', '.astro']) {
  CODE_EXTENSION_SET.add(ext);
}

export const JS_EXTS = extensionsFor('javascript');
export const TS_EXTS = extensionsFor('typescript');
export const CLIKE_EXTS = extensionsFor('clike');
const CPP_EXTENSION_ALLOWLIST = new Set([
  '.cc',
  '.cpp',
  '.cxx',
  '.hpp',
  '.hh',
  '.hxx',
  '.ipp',
  '.ixx',
  '.cppm',
  '.tpp',
  '.inl',
  '.modulemap'
]);
export const CPP_EXTS = new Set(
  [...CLIKE_EXTS].filter((ext) => CPP_EXTENSION_ALLOWLIST.has(ext))
);
const OBJC_EXTENSION_ALLOWLIST = new Set(['.m', '.mm']);
export const OBJC_EXTS = new Set(
  [...CLIKE_EXTS].filter((ext) => OBJC_EXTENSION_ALLOWLIST.has(ext))
);
export const RUST_EXTS = extensionsFor('rust');
export const GO_EXTS = extensionsFor('go');
export const JAVA_EXTS = extensionsFor('java');
export const CSHARP_EXTS = extensionsFor('csharp');
export const KOTLIN_EXTS = extensionsFor('kotlin');
export const RUBY_EXTS = extensionsFor('ruby');
export const PHP_EXTS = extensionsFor('php');
export const HTML_EXTS = extensionsFor('html');
export const CSS_EXTS = extensionsFor('css');
export const LUA_EXTS = extensionsFor('lua');
export const SQL_EXTS = extensionsFor('sql');
export const PERL_EXTS = extensionsFor('perl');
export const SHELL_EXTS = extensionsFor('shell');
export const CMAKE_EXTS = extensionsFor('cmake');
export const STARLARK_EXTS = extensionsFor('starlark');
export const NIX_EXTS = extensionsFor('nix');
export const DART_EXTS = extensionsFor('dart');
export const SCALA_EXTS = extensionsFor('scala');
export const GROOVY_EXTS = extensionsFor('groovy');
export const R_EXTS = extensionsFor('r');
export const JULIA_EXTS = extensionsFor('julia');
export const HANDLEBARS_EXTS = extensionsFor('handlebars');
export const MUSTACHE_EXTS = extensionsFor('mustache');
export const JINJA_EXTS = extensionsFor('jinja');
export const RAZOR_EXTS = extensionsFor('razor');

export const EXTS_CODE = CODE_EXTENSION_SET;

export const CODE_FILENAMES = new Set(SPECIAL_CODE_FILENAMES);

const SPECIAL_CODE_EXTS = new Map(Object.entries(SPECIAL_CODE_FILENAME_TO_EXT));

const SPECIAL_CODE_PREFIXES = new Map(Object.entries(SPECIAL_CODE_PREFIX_TO_EXT));

export const STOP = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself',
  'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did', 'doing',
  'a', 'an', 'the',
  'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while',
  'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under',
  'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
  'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
  'so', 'than', 'too', 'very',
  's', 't', 'can', 'will', 'just', 'don', 'should', 'now'
]);

export const SYN = { err: 'error', cfg: 'config', msg: 'message', init: 'initialize' };

export const CLIKE_TYPE_MAP = {
  class: 'ClassDeclaration',
  struct: 'StructDeclaration',
  enum: 'EnumDeclaration',
  union: 'UnionDeclaration'
};

export const OBJC_TYPE_MAP = {
  interface: 'InterfaceDeclaration',
  implementation: 'ImplementationDeclaration',
  protocol: 'ProtocolDeclaration'
};

export const CLIKE_SKIP_PREFIXES = new Set([
  'if', 'for', 'while', 'switch', 'return', 'case', 'do', 'else',
  'typedef', 'struct', 'class', 'enum', 'union', 'namespace'
]);

export const CLIKE_MODIFIERS = new Set([
  'static', 'inline', 'constexpr', 'virtual', 'explicit', 'extern', 'const',
  'volatile', 'friend', 'register'
]);

export const CLIKE_RESERVED_WORDS = new Set([
  '_Alignas',
  '_Alignof',
  '_Atomic',
  '_Bool',
  '_Complex',
  '_Generic',
  '_Imaginary',
  '_Noreturn',
  '_Static_assert',
  '_Thread_local',
  'alignas',
  'alignof',
  'and',
  'and_eq',
  'asm',
  'auto',
  'bitand',
  'bitor',
  'bool',
  'break',
  'case',
  'catch',
  'char',
  'char16_t',
  'char32_t',
  'char8_t',
  'class',
  'co_await',
  'co_return',
  'co_yield',
  'compl',
  'concept',
  'const',
  'const_cast',
  'consteval',
  'constexpr',
  'constinit',
  'continue',
  'decltype',
  'default',
  'delete',
  'do',
  'double',
  'dynamic_cast',
  'else',
  'enum',
  'explicit',
  'export',
  'extern',
  'false',
  'final',
  'float',
  'for',
  'friend',
  'goto',
  'if',
  'import',
  'inline',
  'int',
  'long',
  'module',
  'mutable',
  'namespace',
  'new',
  'noexcept',
  'not',
  'not_eq',
  'nullptr',
  'operator',
  'or',
  'or_eq',
  'override',
  'private',
  'protected',
  'public',
  'register',
  'reinterpret_cast',
  'requires',
  'restrict',
  'return',
  'short',
  'signed',
  'sizeof',
  'static',
  'static_assert',
  'static_cast',
  'struct',
  'switch',
  'template',
  'this',
  'thread_local',
  'throw',
  'true',
  'try',
  'typedef',
  'typeid',
  'typename',
  'union',
  'unsigned',
  'using',
  'virtual',
  'void',
  'volatile',
  'wchar_t',
  'while',
  'xor',
  'xor_eq'
]);

const OBJC_ONLY_RESERVED_WORDS = [
  'assign',
  'atomic',
  'autoreleasepool',
  'available',
  'class',
  'compatibility_alias',
  'copy',
  'defs',
  'dynamic',
  'encode',
  'end',
  'implementation',
  'import',
  'instancetype',
  'interface',
  'nonatomic',
  'null_resettable',
  'null_unspecified',
  'nonnull',
  'nullable',
  'optional',
  'package',
  'private',
  'property',
  'protocol',
  'protected',
  'public',
  'readonly',
  'readwrite',
  'required',
  'retain',
  'selector',
  'strong',
  'synchronized',
  'synthesize',
  'try',
  'weak'
];

export const CPP_RESERVED_WORDS = new Set([
  ...CLIKE_RESERVED_WORDS
]);

export const OBJC_RESERVED_WORDS = new Set([
  ...CLIKE_RESERVED_WORDS,
  ...OBJC_ONLY_RESERVED_WORDS
]);

export const CLIKE_CALL_KEYWORDS = new Set([
  ...CLIKE_RESERVED_WORDS
]);

export const CLIKE_USAGE_SKIP = new Set([
  ...CLIKE_RESERVED_WORDS,
  'nil',
  'null',
  'self',
  'super'
]);

export const CPP_CALL_KEYWORDS = new Set([
  ...CPP_RESERVED_WORDS
]);

export const CPP_USAGE_SKIP = new Set([
  ...CPP_RESERVED_WORDS,
  'null',
  'nullptr'
]);

export const OBJC_CALL_KEYWORDS = new Set([
  ...OBJC_RESERVED_WORDS
]);

export const OBJC_USAGE_SKIP = new Set([
  ...OBJC_RESERVED_WORDS,
  'nil',
  'null',
  'self',
  'super'
]);

export const CLIKE_EXPORT_KINDS = new Set([
  'ClassDeclaration',
  'StructDeclaration',
  'EnumDeclaration',
  'UnionDeclaration',
  'InterfaceDeclaration',
  'ImplementationDeclaration',
  'ProtocolDeclaration',
  'FunctionDeclaration'
]);

/**
 * Check if an extension is JS-like.
 * @param {string} ext
 * @returns {boolean}
 */
export const isJsLike = (ext) => JS_EXTS.has(ext);
/**
 * Check if an extension is TypeScript.
 * @param {string} ext
 * @returns {boolean}
 */
export const isTypeScript = (ext) => TS_EXTS.has(ext);
/**
 * Check if an extension is C-like.
 * @param {string} ext
 * @returns {boolean}
 */
export const isCLike = (ext) => CLIKE_EXTS.has(ext);
/**
 * Check if an extension is C++.
 * @param {string} ext
 * @returns {boolean}
 */
export const isCpp = (ext) => CPP_EXTS.has(ext);
/**
 * Check if an extension is Objective-C.
 * @param {string} ext
 * @returns {boolean}
 */
export const isObjc = (ext) => OBJC_EXTS.has(ext);
/**
 * Check if an extension is Rust.
 * @param {string} ext
 * @returns {boolean}
 */
export const isRust = (ext) => RUST_EXTS.has(ext);
/**
 * Check if an extension is Go.
 * @param {string} ext
 * @returns {boolean}
 */
export const isGo = (ext) => GO_EXTS.has(ext);
/**
 * Check if an extension is Java.
 * @param {string} ext
 * @returns {boolean}
 */
export const isJava = (ext) => JAVA_EXTS.has(ext);
/**
 * Check if an extension is C#.
 * @param {string} ext
 * @returns {boolean}
 */
export const isCSharp = (ext) => CSHARP_EXTS.has(ext);
/**
 * Check if an extension is Kotlin.
 * @param {string} ext
 * @returns {boolean}
 */
export const isKotlin = (ext) => KOTLIN_EXTS.has(ext);
/**
 * Check if an extension is Ruby.
 * @param {string} ext
 * @returns {boolean}
 */
export const isRuby = (ext) => RUBY_EXTS.has(ext);
/**
 * Check if an extension is PHP.
 * @param {string} ext
 * @returns {boolean}
 */
export const isPhp = (ext) => PHP_EXTS.has(ext);
/**
 * Check if an extension is HTML.
 * @param {string} ext
 * @returns {boolean}
 */
export const isHtml = (ext) => HTML_EXTS.has(ext);
/**
 * Check if an extension is CSS.
 * @param {string} ext
 * @returns {boolean}
 */
export const isCss = (ext) => CSS_EXTS.has(ext);
/**
 * Check if an extension is Lua.
 * @param {string} ext
 * @returns {boolean}
 */
export const isLua = (ext) => LUA_EXTS.has(ext);
/**
 * Check if an extension is SQL.
 * @param {string} ext
 * @returns {boolean}
 */
export const isSql = (ext) => SQL_EXTS.has(ext);
/**
 * Check if an extension is Perl.
 * @param {string} ext
 * @returns {boolean}
 */
export const isPerl = (ext) => PERL_EXTS.has(ext);
/**
 * Check if an extension is a shell script.
 * @param {string} ext
 * @returns {boolean}
 */
export const isShell = (ext) => SHELL_EXTS.has(ext);

/**
 * Check if a filename is a special code file with no extension.
 * @param {string} name
 * @returns {boolean}
 */
export const isSpecialCodeFile = (name) => !!resolveSpecialCodeExt(name);

export const isManifestFile = (name) => {
  const key = String(name || '').toLowerCase();
  if (MANIFEST_FILES.has(key)) return true;
  for (const suffix of MANIFEST_SUFFIXES) {
    if (key.endsWith(suffix)) return true;
  }
  return false;
};

export const isLockFile = (name) => LOCK_FILES.has(String(name || '').toLowerCase());

/**
 * Resolve the extension for special code filenames.
 * @param {string} name
 * @returns {string|null}
 */
export const resolveSpecialCodeExt = (name) => {
  const key = String(name || '').toLowerCase();
  if (SPECIAL_CODE_EXTS.has(key)) return SPECIAL_CODE_EXTS.get(key);
  for (const [prefix, ext] of SPECIAL_CODE_PREFIXES.entries()) {
    if (key === prefix || key.startsWith(`${prefix}.`)) return ext;
  }
  return null;
};
