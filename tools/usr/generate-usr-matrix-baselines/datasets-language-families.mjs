const CAPABILITIES = [
  'imports',
  'relations',
  'docmeta',
  'ast',
  'controlFlow',
  'dataFlow',
  'graphRelations',
  'riskLocal',
  'riskInterprocedural',
  'symbolGraph'
];

const languageBaselines = [
  { id: 'javascript', family: 'js-ts', parserPreference: 'hybrid', requiredConformance: ['C0', 'C1', 'C2', 'C3', 'C4'], frameworkProfiles: ['astro', 'next', 'nuxt', 'react', 'svelte', 'sveltekit', 'vue'], minVersion: 'ecma-2020', dialects: ['cjs', 'esm', 'jsx'], featureFlags: ['jsx', 'top-level-await'] },
  { id: 'typescript', family: 'js-ts', parserPreference: 'hybrid', requiredConformance: ['C0', 'C1', 'C2', 'C3', 'C4'], frameworkProfiles: ['angular', 'astro', 'next', 'nuxt', 'react', 'svelte', 'sveltekit', 'vue'], minVersion: '5.0', dialects: ['ts', 'tsx'], featureFlags: ['decorators', 'jsx', 'project-references'] },
  { id: 'python', family: 'dynamic', parserPreference: 'hybrid', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '3.8', dialects: ['cpython'], featureFlags: ['pattern-matching', 'type-hints'] },
  { id: 'clike', family: 'systems', parserPreference: 'hybrid', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: 'c11-cpp17', dialects: ['c', 'cpp'], featureFlags: ['preprocessor', 'templates'] },
  { id: 'go', family: 'systems', parserPreference: 'hybrid', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '1.20', dialects: ['go'], featureFlags: ['generics', 'modules'] },
  { id: 'java', family: 'managed', parserPreference: 'hybrid', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '17', dialects: ['java'], featureFlags: ['records', 'sealed-types'] },
  { id: 'csharp', family: 'managed', parserPreference: 'hybrid', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '11', dialects: ['csharp'], featureFlags: ['nullable-reference-types', 'records'] },
  { id: 'kotlin', family: 'managed', parserPreference: 'hybrid', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '1.9', dialects: ['kotlin'], featureFlags: ['k2', 'suspend'] },
  { id: 'ruby', family: 'dynamic', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '3.1', dialects: ['ruby'], featureFlags: ['pattern-matching'] },
  { id: 'php', family: 'dynamic', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '8.1', dialects: ['php'], featureFlags: ['attributes', 'union-types'] },
  { id: 'html', family: 'markup', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C4'], frameworkProfiles: ['angular', 'astro', 'nuxt', 'svelte', 'sveltekit', 'vue'], minVersion: 'html5', dialects: ['html'], featureFlags: ['custom-elements'] },
  { id: 'css', family: 'style', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C4'], frameworkProfiles: ['astro', 'nuxt', 'svelte', 'sveltekit', 'vue'], minVersion: 'css3', dialects: ['css', 'scss'], featureFlags: ['modules', 'nesting'] },
  { id: 'lua', family: 'dynamic', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '5.4', dialects: ['lua'], featureFlags: ['metatables'] },
  { id: 'sql', family: 'data-interface', parserPreference: 'hybrid', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: 'sql-2016', dialects: ['ansi-sql', 'postgresql', 'sqlite'], featureFlags: ['cte', 'window-functions'] },
  { id: 'perl', family: 'dynamic', parserPreference: 'heuristic', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '5.34', dialects: ['perl5'], featureFlags: ['regex-extended'] },
  { id: 'shell', family: 'dynamic', parserPreference: 'hybrid', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: 'bash-5', dialects: ['bash', 'posix-sh'], featureFlags: ['process-substitution'] },
  { id: 'rust', family: 'systems', parserPreference: 'hybrid', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '1.74', dialects: ['rust'], featureFlags: ['macros', 'traits'] },
  { id: 'swift', family: 'systems', parserPreference: 'hybrid', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '5.9', dialects: ['swift'], featureFlags: ['result-builders'] },
  { id: 'cmake', family: 'build-dsl', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: '3.25', dialects: ['cmake'], featureFlags: ['generator-expressions'] },
  { id: 'starlark', family: 'build-dsl', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: '1.0', dialects: ['bazel-starlark'], featureFlags: ['load', 'rule-macros'] },
  { id: 'nix', family: 'build-dsl', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: '2.18', dialects: ['nix'], featureFlags: ['flakes'] },
  { id: 'dart', family: 'managed', parserPreference: 'hybrid', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '3.0', dialects: ['dart'], featureFlags: ['null-safety', 'records'] },
  { id: 'scala', family: 'managed', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '3.3', dialects: ['scala3'], featureFlags: ['givens', 'opaque-types'] },
  { id: 'groovy', family: 'managed', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '4.0', dialects: ['groovy'], featureFlags: ['ast-transforms'] },
  { id: 'r', family: 'dynamic', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '4.3', dialects: ['r'], featureFlags: ['tidy-eval'] },
  { id: 'julia', family: 'dynamic', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '1.10', dialects: ['julia'], featureFlags: ['macros', 'multiple-dispatch'] },
  { id: 'handlebars', family: 'markup', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C4'], frameworkProfiles: [], minVersion: '4.x', dialects: ['handlebars'], featureFlags: ['helpers', 'partials'] },
  { id: 'mustache', family: 'markup', parserPreference: 'heuristic', requiredConformance: ['C0', 'C1', 'C4'], frameworkProfiles: [], minVersion: '1.0', dialects: ['mustache'], featureFlags: ['partials'] },
  { id: 'jinja', family: 'markup', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C4'], frameworkProfiles: [], minVersion: '3.1', dialects: ['jinja2'], featureFlags: ['filters', 'macros'] },
  { id: 'razor', family: 'markup', parserPreference: 'hybrid', requiredConformance: ['C0', 'C1', 'C4'], frameworkProfiles: [], minVersion: 'aspnetcore-8', dialects: ['razor'], featureFlags: ['model-binding', 'tag-helpers'] },
  { id: 'proto', family: 'data-interface', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: 'proto3', dialects: ['proto3'], featureFlags: ['imports', 'options'] },
  { id: 'makefile', family: 'build-dsl', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: 'gnu-make-4.4', dialects: ['gnu-make'], featureFlags: ['pattern-rules'] },
  { id: 'dockerfile', family: 'build-dsl', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: 'dockerfile-1.5', dialects: ['dockerfile'], featureFlags: ['multistage'] },
  { id: 'graphql', family: 'data-interface', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: '2021-10', dialects: ['graphql-query', 'graphql-schema'], featureFlags: ['directives', 'fragments'] },
  { id: 'ini', family: 'config-data', parserPreference: 'heuristic', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: 'ini-1.0', dialects: ['cfg', 'ini'], featureFlags: ['sections'] },
  { id: 'json', family: 'config-data', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: 'rfc-8259', dialects: ['json'], featureFlags: ['arrays', 'nested-objects'] },
  { id: 'toml', family: 'config-data', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: '1.0.0', dialects: ['toml'], featureFlags: ['arrays-of-tables'] },
  { id: 'xml', family: 'config-data', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: 'xml-1.0', dialects: ['xml'], featureFlags: ['namespaces', 'xinclude'] },
  { id: 'yaml', family: 'config-data', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: '1.2', dialects: ['yaml'], featureFlags: ['aliases', 'anchors'] }
];

const familyNodeKinds = {
  'js-ts': ['call_expr', 'class_decl', 'export_stmt', 'function_decl', 'import_stmt', 'module_decl'],
  systems: ['call_expr', 'function_decl', 'module_decl', 'type_alias_decl', 'variable_decl'],
  managed: ['class_decl', 'field_decl', 'interface_decl', 'method_decl', 'param_decl'],
  dynamic: ['call_expr', 'control_stmt', 'function_decl', 'variable_decl'],
  markup: ['css_rule', 'directive_expr', 'html_element', 'template_element'],
  style: ['css_rule', 'directive_expr', 'html_element', 'template_element'],
  'data-interface': ['graphql_type_decl', 'interface_decl', 'sql_stmt', 'type_alias_decl'],
  'build-dsl': ['build_stmt', 'call_expr', 'variable_decl'],
  'config-data': ['config_key', 'config_mapping', 'config_scalar', 'config_section', 'config_sequence']
};

const familyEdgeKinds = {
  'js-ts': ['calls', 'defines', 'exports', 'imports', 'references', 'uses_type'],
  systems: ['calls', 'defines', 'extends', 'implements', 'imports', 'references'],
  managed: ['calls', 'defines', 'extends', 'implements', 'imports', 'references', 'uses_type'],
  dynamic: ['calls', 'contains', 'defines', 'imports', 'references'],
  markup: ['contains', 'style_scopes', 'template_binds', 'template_emits'],
  style: ['contains', 'style_scopes', 'template_binds', 'template_emits'],
  'data-interface': ['contains', 'references', 'uses_type'],
  'build-dsl': ['calls', 'contains', 'references'],
  'config-data': ['contains', 'references']
};

const familyCapabilities = {
  'js-ts': {
    imports: 'supported',
    relations: 'supported',
    docmeta: 'supported',
    ast: 'supported',
    controlFlow: 'supported',
    dataFlow: 'supported',
    graphRelations: 'supported',
    riskLocal: 'supported',
    riskInterprocedural: 'partial',
    symbolGraph: 'supported'
  },
  systems: {
    imports: 'supported',
    relations: 'supported',
    docmeta: 'supported',
    ast: 'supported',
    controlFlow: 'supported',
    dataFlow: 'supported',
    graphRelations: 'supported',
    riskLocal: 'supported',
    riskInterprocedural: 'partial',
    symbolGraph: 'supported'
  },
  managed: {
    imports: 'supported',
    relations: 'supported',
    docmeta: 'supported',
    ast: 'supported',
    controlFlow: 'supported',
    dataFlow: 'supported',
    graphRelations: 'supported',
    riskLocal: 'supported',
    riskInterprocedural: 'partial',
    symbolGraph: 'supported'
  },
  dynamic: {
    imports: 'supported',
    relations: 'supported',
    docmeta: 'supported',
    ast: 'supported',
    controlFlow: 'supported',
    dataFlow: 'partial',
    graphRelations: 'supported',
    riskLocal: 'supported',
    riskInterprocedural: 'partial',
    symbolGraph: 'supported'
  },
  markup: {
    imports: 'partial',
    relations: 'partial',
    docmeta: 'supported',
    ast: 'partial',
    controlFlow: 'unsupported',
    dataFlow: 'unsupported',
    graphRelations: 'partial',
    riskLocal: 'partial',
    riskInterprocedural: 'unsupported',
    symbolGraph: 'partial'
  },
  style: {
    imports: 'unsupported',
    relations: 'partial',
    docmeta: 'supported',
    ast: 'partial',
    controlFlow: 'unsupported',
    dataFlow: 'unsupported',
    graphRelations: 'partial',
    riskLocal: 'partial',
    riskInterprocedural: 'unsupported',
    symbolGraph: 'partial'
  },
  'data-interface': {
    imports: 'partial',
    relations: 'supported',
    docmeta: 'supported',
    ast: 'supported',
    controlFlow: 'unsupported',
    dataFlow: 'unsupported',
    graphRelations: 'supported',
    riskLocal: 'partial',
    riskInterprocedural: 'unsupported',
    symbolGraph: 'supported'
  },
  'build-dsl': {
    imports: 'unsupported',
    relations: 'partial',
    docmeta: 'supported',
    ast: 'partial',
    controlFlow: 'partial',
    dataFlow: 'partial',
    graphRelations: 'partial',
    riskLocal: 'partial',
    riskInterprocedural: 'unsupported',
    symbolGraph: 'partial'
  },
  'config-data': {
    imports: 'partial',
    relations: 'partial',
    docmeta: 'supported',
    ast: 'partial',
    controlFlow: 'unsupported',
    dataFlow: 'unsupported',
    graphRelations: 'partial',
    riskLocal: 'partial',
    riskInterprocedural: 'unsupported',
    symbolGraph: 'partial'
  }
};

const parserFallbackByPreference = {
  native: ['native-parser', 'tooling', 'heuristic'],
  hybrid: ['native-parser', 'tree-sitter', 'tooling', 'heuristic'],
  'tree-sitter': ['tree-sitter', 'tooling', 'heuristic'],
  heuristic: ['heuristic']
};

const customEmbeddingPolicies = {
  javascript: { canHostEmbedded: true, canBeEmbedded: true, embeddedLanguageAllowlist: ['css', 'graphql', 'html', 'sql'] },
  typescript: { canHostEmbedded: true, canBeEmbedded: true, embeddedLanguageAllowlist: ['css', 'graphql', 'html', 'sql'] },
  html: { canHostEmbedded: true, canBeEmbedded: true, embeddedLanguageAllowlist: ['css', 'handlebars', 'javascript', 'jinja', 'mustache', 'razor', 'typescript'] },
  css: { canHostEmbedded: false, canBeEmbedded: true, embeddedLanguageAllowlist: [] },
  handlebars: { canHostEmbedded: true, canBeEmbedded: true, embeddedLanguageAllowlist: ['css', 'html', 'javascript'] },
  mustache: { canHostEmbedded: true, canBeEmbedded: true, embeddedLanguageAllowlist: ['css', 'html', 'javascript'] },
  jinja: { canHostEmbedded: true, canBeEmbedded: true, embeddedLanguageAllowlist: ['css', 'html', 'javascript', 'typescript'] },
  razor: { canHostEmbedded: true, canBeEmbedded: true, embeddedLanguageAllowlist: ['csharp', 'css', 'html', 'javascript'] },
  sql: { canHostEmbedded: false, canBeEmbedded: true, embeddedLanguageAllowlist: [] },
  graphql: { canHostEmbedded: false, canBeEmbedded: true, embeddedLanguageAllowlist: [] },
  proto: { canHostEmbedded: false, canBeEmbedded: true, embeddedLanguageAllowlist: [] }
};

export {
  CAPABILITIES,
  languageBaselines,
  familyNodeKinds,
  familyEdgeKinds,
  familyCapabilities,
  parserFallbackByPreference,
  customEmbeddingPolicies
};
