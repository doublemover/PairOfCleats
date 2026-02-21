export const LANGUAGE_ROUTE_DESCRIPTORS = Object.freeze([
  Object.freeze({
    id: 'javascript',
    adapterId: 'javascript',
    parserRoute: 'tree-sitter-js',
    capsProfile: 'javascript-default',
    extensions: Object.freeze(['.js', '.mjs', '.cjs', '.jsx'])
  }),
  Object.freeze({
    id: 'typescript',
    adapterId: 'typescript',
    parserRoute: 'tree-sitter-ts',
    capsProfile: 'typescript-default',
    extensions: Object.freeze(['.ts', '.tsx', '.mts', '.cts'])
  }),
  Object.freeze({
    id: 'python',
    adapterId: 'python',
    parserRoute: 'python-ast-tree-sitter',
    capsProfile: 'python-default',
    extensions: Object.freeze(['.py'])
  }),
  Object.freeze({
    id: 'clike',
    adapterId: 'clike',
    parserRoute: 'tree-sitter-clike',
    capsProfile: 'clike-default',
    extensions: Object.freeze([
      '.c',
      '.h',
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
      '.modulemap',
      '.m',
      '.mm'
    ])
  }),
  Object.freeze({
    id: 'go',
    adapterId: 'go',
    parserRoute: 'tree-sitter-go',
    capsProfile: 'go-default',
    extensions: Object.freeze(['.go']),
    specialFilenames: Object.freeze(['go.mod'])
  }),
  Object.freeze({
    id: 'java',
    adapterId: 'java',
    parserRoute: 'tree-sitter-java',
    capsProfile: 'java-default',
    extensions: Object.freeze(['.java'])
  }),
  Object.freeze({
    id: 'csharp',
    adapterId: 'csharp',
    parserRoute: 'tree-sitter-c-sharp',
    capsProfile: 'csharp-default',
    extensions: Object.freeze(['.cs'])
  }),
  Object.freeze({
    id: 'kotlin',
    adapterId: 'kotlin',
    parserRoute: 'tree-sitter-kotlin',
    capsProfile: 'kotlin-default',
    extensions: Object.freeze(['.kt', '.kts'])
  }),
  Object.freeze({
    id: 'ruby',
    adapterId: 'ruby',
    parserRoute: 'tree-sitter-ruby',
    capsProfile: 'ruby-default',
    extensions: Object.freeze(['.rb'])
  }),
  Object.freeze({
    id: 'php',
    adapterId: 'php',
    parserRoute: 'tree-sitter-php',
    capsProfile: 'php-default',
    extensions: Object.freeze(['.php', '.phtml'])
  }),
  Object.freeze({
    id: 'html',
    adapterId: 'html',
    parserRoute: 'tree-sitter-html',
    capsProfile: 'html-default',
    extensions: Object.freeze(['.html', '.htm'])
  }),
  Object.freeze({
    id: 'css',
    adapterId: 'css',
    parserRoute: 'tree-sitter-css',
    capsProfile: 'css-default',
    extensions: Object.freeze(['.css'])
  }),
  Object.freeze({
    id: 'lua',
    adapterId: 'lua',
    parserRoute: 'tree-sitter-lua',
    capsProfile: 'lua-default',
    extensions: Object.freeze(['.lua'])
  }),
  Object.freeze({
    id: 'sql',
    adapterId: 'sql',
    parserRoute: 'tree-sitter-sql',
    capsProfile: 'sql-default',
    extensions: Object.freeze(['.sql', '.psql', '.pgsql', '.mysql', '.sqlite'])
  }),
  Object.freeze({
    id: 'perl',
    adapterId: 'perl',
    parserRoute: 'tree-sitter-perl',
    capsProfile: 'perl-default',
    extensions: Object.freeze(['.pl', '.pm'])
  }),
  Object.freeze({
    id: 'shell',
    adapterId: 'shell',
    parserRoute: 'tree-sitter-shell',
    capsProfile: 'shell-default',
    extensions: Object.freeze(['.sh', '.bash', '.zsh', '.ksh'])
  }),
  Object.freeze({
    id: 'rust',
    adapterId: 'rust',
    parserRoute: 'tree-sitter-rust',
    capsProfile: 'rust-default',
    extensions: Object.freeze(['.rs'])
  }),
  Object.freeze({
    id: 'swift',
    adapterId: 'swift',
    parserRoute: 'tree-sitter-swift',
    capsProfile: 'swift-default',
    extensions: Object.freeze(['.swift'])
  }),
  Object.freeze({
    id: 'cmake',
    adapterId: 'cmake',
    parserRoute: 'tree-sitter-cmake',
    capsProfile: 'cmake-default',
    extensions: Object.freeze(['.cmake']),
    specialFilenames: Object.freeze(['cmakelists.txt'])
  }),
  Object.freeze({
    id: 'starlark',
    adapterId: 'starlark',
    parserRoute: 'tree-sitter-starlark',
    capsProfile: 'starlark-default',
    extensions: Object.freeze(['.bzl', '.bazel', '.star']),
    specialFilenames: Object.freeze([
      'build',
      'build.bazel',
      'workspace',
      'workspace.bazel',
      'workspace.bzlmod',
      'module',
      'module.bazel'
    ])
  }),
  Object.freeze({
    id: 'nix',
    adapterId: 'nix',
    parserRoute: 'tree-sitter-nix',
    capsProfile: 'nix-default',
    extensions: Object.freeze(['.nix']),
    specialFilenames: Object.freeze(['flake.nix', 'default.nix', 'shell.nix'])
  }),
  Object.freeze({
    id: 'dart',
    adapterId: 'dart',
    parserRoute: 'tree-sitter-dart',
    capsProfile: 'dart-default',
    extensions: Object.freeze(['.dart'])
  }),
  Object.freeze({
    id: 'scala',
    adapterId: 'scala',
    parserRoute: 'tree-sitter-scala',
    capsProfile: 'scala-default',
    extensions: Object.freeze(['.scala', '.sc'])
  }),
  Object.freeze({
    id: 'groovy',
    adapterId: 'groovy',
    parserRoute: 'tree-sitter-groovy',
    capsProfile: 'groovy-default',
    extensions: Object.freeze(['.groovy', '.gradle', '.gvy'])
  }),
  Object.freeze({
    id: 'r',
    adapterId: 'r',
    parserRoute: 'tree-sitter-r',
    capsProfile: 'r-default',
    extensions: Object.freeze(['.r'])
  }),
  Object.freeze({
    id: 'julia',
    adapterId: 'julia',
    parserRoute: 'tree-sitter-julia',
    capsProfile: 'julia-default',
    extensions: Object.freeze(['.jl'])
  }),
  Object.freeze({
    id: 'handlebars',
    adapterId: 'handlebars',
    parserRoute: 'tree-sitter-handlebars',
    capsProfile: 'handlebars-default',
    extensions: Object.freeze(['.hbs', '.handlebars'])
  }),
  Object.freeze({
    id: 'mustache',
    adapterId: 'mustache',
    parserRoute: 'tree-sitter-mustache',
    capsProfile: 'mustache-default',
    extensions: Object.freeze(['.mustache'])
  }),
  Object.freeze({
    id: 'jinja',
    adapterId: 'jinja',
    parserRoute: 'tree-sitter-jinja',
    capsProfile: 'jinja-default',
    extensions: Object.freeze(['.jinja', '.jinja2', '.j2', '.django', '.djhtml'])
  }),
  Object.freeze({
    id: 'razor',
    adapterId: 'razor',
    parserRoute: 'tree-sitter-razor',
    capsProfile: 'razor-default',
    extensions: Object.freeze(['.razor', '.cshtml'])
  }),
  Object.freeze({
    id: 'proto',
    adapterId: 'proto',
    parserRoute: 'tree-sitter-proto',
    capsProfile: 'proto-default',
    extensions: Object.freeze(['.proto']),
    specialFilenames: Object.freeze(['buf.yaml', 'buf.gen.yaml'])
  }),
  Object.freeze({
    id: 'makefile',
    adapterId: 'makefile',
    parserRoute: 'line-parser-makefile',
    capsProfile: 'makefile-default',
    extensions: Object.freeze(['.makefile']),
    specialFilenames: Object.freeze(['makefile', 'gnumakefile', 'bsdmakefile']),
    specialPrefixes: Object.freeze(['makefile'])
  }),
  Object.freeze({
    id: 'dockerfile',
    adapterId: 'dockerfile',
    parserRoute: 'line-parser-dockerfile',
    capsProfile: 'dockerfile-default',
    extensions: Object.freeze(['.dockerfile']),
    specialFilenames: Object.freeze(['dockerfile', 'containerfile']),
    specialPrefixes: Object.freeze(['dockerfile', 'containerfile'])
  }),
  Object.freeze({
    id: 'graphql',
    adapterId: 'graphql',
    parserRoute: 'tree-sitter-graphql',
    capsProfile: 'graphql-default',
    extensions: Object.freeze(['.graphql', '.gql'])
  }),
  Object.freeze({
    id: 'ini',
    adapterId: 'ini',
    parserRoute: 'structured-ini',
    capsProfile: 'ini-default',
    extensions: Object.freeze(['.ini', '.cfg', '.conf'])
  }),
  Object.freeze({
    id: 'json',
    adapterId: 'json',
    parserRoute: 'structured-json',
    capsProfile: 'json-default',
    extensions: Object.freeze(['.json', '.jsonc', '.resolved'])
  }),
  Object.freeze({
    id: 'toml',
    adapterId: 'toml',
    parserRoute: 'structured-toml',
    capsProfile: 'toml-default',
    extensions: Object.freeze(['.toml']),
    specialFilenames: Object.freeze(['pipfile'])
  }),
  Object.freeze({
    id: 'xml',
    adapterId: 'xml',
    parserRoute: 'structured-xml',
    capsProfile: 'xml-default',
    extensions: Object.freeze(['.xml', '.props', '.targets', '.csproj', '.config'])
  }),
  Object.freeze({
    id: 'yaml',
    adapterId: 'yaml',
    parserRoute: 'structured-yaml',
    capsProfile: 'yaml-default',
    extensions: Object.freeze(['.yaml', '.yml'])
  })
]);

export const LANGUAGE_DESCRIPTOR_BY_ID = new Map(
  LANGUAGE_ROUTE_DESCRIPTORS.map((entry) => [entry.id, entry])
);

export const getLanguageDescriptor = (id) => LANGUAGE_DESCRIPTOR_BY_ID.get(String(id || '').trim()) || null;
