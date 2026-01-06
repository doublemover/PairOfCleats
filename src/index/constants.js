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
  '**/*.d.ts.map',
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
  '.repometrics',
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

export const EXTS_PROSE = new Set(['.md', '.txt', '.rst', '.adoc', '.asciidoc']);

export const JS_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx']);
export const TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts']);
export const CLIKE_EXTS = new Set(['.c', '.h', '.cc', '.cpp', '.hpp', '.hh', '.m', '.mm']);
export const OBJC_EXTS = new Set(['.m', '.mm']);
export const RUST_EXTS = new Set(['.rs']);
export const GO_EXTS = new Set(['.go']);
export const JAVA_EXTS = new Set(['.java']);
export const CSHARP_EXTS = new Set(['.cs']);
export const KOTLIN_EXTS = new Set(['.kt', '.kts']);
export const RUBY_EXTS = new Set(['.rb']);
export const PHP_EXTS = new Set(['.php', '.phtml']);
export const HTML_EXTS = new Set(['.html', '.htm']);
export const CSS_EXTS = new Set(['.css']);
export const LUA_EXTS = new Set(['.lua']);
export const SQL_EXTS = new Set(['.sql', '.psql', '.pgsql', '.mysql', '.sqlite']);
export const PERL_EXTS = new Set(['.pl', '.pm']);
export const SHELL_EXTS = new Set(['.sh', '.bash', '.zsh', '.ksh']);

export const EXTS_CODE = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.yml', '.yaml', '.sh',
  '.html', '.htm', '.css', '.py', '.swift', '.rs', '.c', '.cc', '.cpp', '.h', '.hpp', '.hh',
  '.m', '.mm', '.go', '.java', '.cs', '.kt', '.kts', '.rb', '.php', '.phtml',
  '.lua', '.sql', '.psql', '.pgsql', '.mysql', '.sqlite', '.pl', '.pm', '.bash',
  '.zsh', '.ksh', '.json', '.toml', '.ini', '.xml', '.cfg', '.conf'
]);

export const CODE_FILENAMES = new Set(['dockerfile', 'makefile']);

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

export const CLIKE_CALL_KEYWORDS = new Set([
  ...CLIKE_SKIP_PREFIXES,
  'sizeof', 'alignof', 'catch', 'throw', 'new', 'delete', 'goto',
  'static_cast', 'reinterpret_cast', 'const_cast', 'dynamic_cast'
]);

export const CLIKE_USAGE_SKIP = new Set([
  ...CLIKE_CALL_KEYWORDS,
  'void', 'int', 'char', 'short', 'long', 'float', 'double', 'bool',
  'signed', 'unsigned', 'const', 'volatile', 'static', 'extern', 'register',
  'public', 'private', 'protected', 'template', 'typename', 'using', 'namespace',
  'true', 'false', 'null', 'nullptr', 'nil', 'self', 'super'
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
export const isSpecialCodeFile = (name) => CODE_FILENAMES.has(String(name || '').toLowerCase());
