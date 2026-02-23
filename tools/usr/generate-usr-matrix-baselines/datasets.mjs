import { buildFixtureGovernance } from './fixture-governance.mjs';

const SCHEMA_VERSION = 'usr-registry-1.0.0';

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
  { id: 'kotlin', family: 'managed', parserPreference: 'hybrid', requiredConformance: ['C0', 'C1', 'C2', 'C3'], frameworkProfiles: [], minVersion: '1.9', dialects: ['kotlin'], featureFlags: ['suspend', 'k2'] },
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
  { id: 'razor', family: 'markup', parserPreference: 'hybrid', requiredConformance: ['C0', 'C1', 'C4'], frameworkProfiles: [], minVersion: 'aspnetcore-8', dialects: ['razor'], featureFlags: ['tag-helpers', 'model-binding'] },
  { id: 'proto', family: 'data-interface', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: 'proto3', dialects: ['proto3'], featureFlags: ['options', 'imports'] },
  { id: 'makefile', family: 'build-dsl', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: 'gnu-make-4.4', dialects: ['gnu-make'], featureFlags: ['pattern-rules'] },
  { id: 'dockerfile', family: 'build-dsl', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: 'dockerfile-1.5', dialects: ['dockerfile'], featureFlags: ['multistage'] },
  { id: 'graphql', family: 'data-interface', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: '2021-10', dialects: ['graphql-schema', 'graphql-query'], featureFlags: ['directives', 'fragments'] },
  { id: 'ini', family: 'config-data', parserPreference: 'heuristic', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: 'ini-1.0', dialects: ['cfg', 'ini'], featureFlags: ['sections'] },
  { id: 'json', family: 'config-data', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: 'rfc-8259', dialects: ['json'], featureFlags: ['arrays', 'nested-objects'] },
  { id: 'toml', family: 'config-data', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: '1.0.0', dialects: ['toml'], featureFlags: ['arrays-of-tables'] },
  { id: 'xml', family: 'config-data', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: 'xml-1.0', dialects: ['xml'], featureFlags: ['namespaces', 'xinclude'] },
  { id: 'yaml', family: 'config-data', parserPreference: 'tree-sitter', requiredConformance: ['C0', 'C1', 'C2'], frameworkProfiles: [], minVersion: '1.2', dialects: ['yaml'], featureFlags: ['anchors', 'aliases'] }
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
  razor: { canHostEmbedded: true, canBeEmbedded: true, embeddedLanguageAllowlist: ['css', 'csharp', 'html', 'javascript'] },
  sql: { canHostEmbedded: false, canBeEmbedded: true, embeddedLanguageAllowlist: [] },
  graphql: { canHostEmbedded: false, canBeEmbedded: true, embeddedLanguageAllowlist: [] },
  proto: { canHostEmbedded: false, canBeEmbedded: true, embeddedLanguageAllowlist: [] }
};

const frameworkProfiles = [
  {
    id: 'angular',
    detectionPrecedence: ['config-override', 'angular-decorator-signals', 'angular-workspace-config', 'package-signatures', 'heuristic'],
    appliesToLanguages: ['html', 'typescript'],
    segmentationRules: {
      blocks: ['script', 'template', 'style'],
      ordering: ['container-segmentation', 'virtual-documents', 'parse-blocks', 'emit-local-entities', 'emit-bridge-edges', 'route-style-hydration-enrichment'],
      crossBlockLinking: ['component-template-bindings', 'template-style-scope-ownership']
    },
    bindingSemantics: {
      requiredEdgeKinds: ['template_binds', 'template_emits', 'style_scopes', 'route_maps_to', 'hydration_boundary'],
      requiredAttrs: {
        template_binds: ['bindingKind'],
        template_emits: ['eventKind'],
        style_scopes: ['scopeKind'],
        route_maps_to: ['routePattern', 'runtimeSide'],
        hydration_boundary: ['runtimeSide']
      }
    },
    routeSemantics: {
      enabled: true,
      patternCanon: 'bracket-form',
      runtimeSides: ['client', 'server', 'universal', 'unknown']
    },
    hydrationSemantics: {
      required: true,
      boundarySignals: ['ng-hydrate', 'universal-handoff'],
      ssrCsrModes: ['ssr', 'csr', 'hybrid']
    },
    embeddedLanguageBridges: [
      { sourceBlock: 'script', targetBlock: 'template', edgeKinds: ['template_binds', 'template_emits'] },
      { sourceBlock: 'template', targetBlock: 'style', edgeKinds: ['style_scopes'] }
    ],
    edgeCaseCaseIds: ['angular-input-output-binding', 'angular-route-config-lazy', 'angular-template-style-encapsulation'],
    requiredConformance: ['C4']
  },
  {
    id: 'astro',
    detectionPrecedence: ['config-override', 'astro-file-signature', 'astro-config', 'package-signatures', 'heuristic'],
    appliesToLanguages: ['css', 'html', 'javascript', 'typescript'],
    segmentationRules: {
      blocks: ['frontmatter', 'template', 'style', 'island'],
      ordering: ['container-segmentation', 'virtual-documents', 'parse-blocks', 'emit-local-entities', 'emit-bridge-edges', 'route-style-hydration-enrichment'],
      crossBlockLinking: ['frontmatter-template-bridge', 'island-hydration-bridge']
    },
    bindingSemantics: {
      requiredEdgeKinds: ['template_binds', 'template_emits', 'style_scopes', 'route_maps_to', 'hydration_boundary'],
      requiredAttrs: {
        template_binds: ['bindingKind'],
        template_emits: ['eventKind'],
        style_scopes: ['scopeKind'],
        route_maps_to: ['routePattern', 'runtimeSide'],
        hydration_boundary: ['runtimeSide']
      }
    },
    routeSemantics: {
      enabled: true,
      patternCanon: 'bracket-form',
      runtimeSides: ['client', 'server', 'universal', 'unknown']
    },
    hydrationSemantics: {
      required: true,
      boundarySignals: ['client:load', 'client:idle', 'client:visible', 'client:media', 'client:only'],
      ssrCsrModes: ['ssr', 'island', 'hybrid']
    },
    embeddedLanguageBridges: [
      { sourceBlock: 'frontmatter', targetBlock: 'template', edgeKinds: ['template_binds'] },
      { sourceBlock: 'template', targetBlock: 'style', edgeKinds: ['style_scopes'] }
    ],
    edgeCaseCaseIds: ['astro-component-style-scope', 'astro-frontmatter-template-bridge', 'astro-island-hydration', 'astro-route-collection', 'astro-template-slot-props'],
    requiredConformance: ['C4']
  },
  {
    id: 'next',
    detectionPrecedence: ['config-override', 'next-app-pages-conventions', 'next-config-signals', 'package-signatures', 'heuristic'],
    appliesToLanguages: ['javascript', 'typescript'],
    segmentationRules: {
      blocks: ['script', 'template', 'style', 'route'],
      ordering: ['container-segmentation', 'virtual-documents', 'parse-blocks', 'emit-local-entities', 'emit-bridge-edges', 'route-style-hydration-enrichment'],
      crossBlockLinking: ['server-client-boundary', 'route-component-binding']
    },
    bindingSemantics: {
      requiredEdgeKinds: ['template_binds', 'template_emits', 'style_scopes', 'route_maps_to', 'hydration_boundary'],
      requiredAttrs: {
        template_binds: ['bindingKind'],
        template_emits: ['eventKind'],
        style_scopes: ['scopeKind'],
        route_maps_to: ['routePattern', 'runtimeSide'],
        hydration_boundary: ['runtimeSide']
      }
    },
    routeSemantics: {
      enabled: true,
      patternCanon: 'bracket-form',
      runtimeSides: ['client', 'server', 'universal', 'unknown']
    },
    hydrationSemantics: {
      required: true,
      boundarySignals: ['use client', 'server-component-boundary'],
      ssrCsrModes: ['ssr', 'csr', 'rsc', 'hybrid']
    },
    embeddedLanguageBridges: [
      { sourceBlock: 'route', targetBlock: 'script', edgeKinds: ['route_maps_to'] },
      { sourceBlock: 'script', targetBlock: 'style', edgeKinds: ['style_scopes'] }
    ],
    edgeCaseCaseIds: ['next-app-router-dynamic-segment', 'next-client-server-boundary', 'next-css-module-style-scope', 'next-route-handler-runtime', 'next-rsc-template-props'],
    requiredConformance: ['C4']
  },
  {
    id: 'nuxt',
    detectionPrecedence: ['config-override', 'nuxt-config-signature', 'pages-server-conventions', 'package-signatures', 'heuristic'],
    appliesToLanguages: ['css', 'html', 'javascript', 'typescript'],
    segmentationRules: {
      blocks: ['template', 'script', 'style', 'route'],
      ordering: ['container-segmentation', 'virtual-documents', 'parse-blocks', 'emit-local-entities', 'emit-bridge-edges', 'route-style-hydration-enrichment'],
      crossBlockLinking: ['template-script-bridge', 'route-component-binding']
    },
    bindingSemantics: {
      requiredEdgeKinds: ['template_binds', 'template_emits', 'style_scopes', 'route_maps_to', 'hydration_boundary'],
      requiredAttrs: {
        template_binds: ['bindingKind'],
        template_emits: ['eventKind'],
        style_scopes: ['scopeKind'],
        route_maps_to: ['routePattern', 'runtimeSide'],
        hydration_boundary: ['runtimeSide']
      }
    },
    routeSemantics: {
      enabled: true,
      patternCanon: 'bracket-form',
      runtimeSides: ['client', 'server', 'universal', 'unknown']
    },
    hydrationSemantics: {
      required: true,
      boundarySignals: ['nuxt-client-only', 'suspense-boundary'],
      ssrCsrModes: ['ssr', 'csr', 'universal']
    },
    embeddedLanguageBridges: [
      { sourceBlock: 'template', targetBlock: 'script', edgeKinds: ['template_binds', 'template_emits'] },
      { sourceBlock: 'template', targetBlock: 'style', edgeKinds: ['style_scopes'] }
    ],
    edgeCaseCaseIds: ['nuxt-pages-route-params', 'nuxt-server-route-mapping', 'nuxt-sfc-style-scope', 'nuxt-template-composable-binding'],
    requiredConformance: ['C4']
  },
  {
    id: 'react',
    detectionPrecedence: ['config-override', 'jsx-tsx-signals', 'jsx-runtime-signals', 'package-signatures', 'heuristic'],
    appliesToLanguages: ['javascript', 'typescript'],
    segmentationRules: {
      blocks: ['script', 'template', 'style', 'route'],
      ordering: ['container-segmentation', 'virtual-documents', 'parse-blocks', 'emit-local-entities', 'emit-bridge-edges', 'route-style-hydration-enrichment'],
      crossBlockLinking: ['jsx-prop-binding', 'router-component-binding']
    },
    bindingSemantics: {
      requiredEdgeKinds: ['template_binds', 'template_emits', 'style_scopes', 'route_maps_to', 'hydration_boundary'],
      requiredAttrs: {
        template_binds: ['bindingKind'],
        template_emits: ['eventKind'],
        style_scopes: ['scopeKind'],
        route_maps_to: ['routePattern', 'runtimeSide'],
        hydration_boundary: ['runtimeSide']
      }
    },
    routeSemantics: {
      enabled: true,
      patternCanon: 'bracket-form',
      runtimeSides: ['client', 'server', 'universal', 'unknown']
    },
    hydrationSemantics: {
      required: true,
      boundarySignals: ['hydrateRoot', 'createRoot', 'server-render-boundary'],
      ssrCsrModes: ['csr', 'ssr', 'hybrid']
    },
    embeddedLanguageBridges: [
      { sourceBlock: 'script', targetBlock: 'template', edgeKinds: ['template_binds', 'template_emits'] },
      { sourceBlock: 'script', targetBlock: 'style', edgeKinds: ['style_scopes'] }
    ],
    edgeCaseCaseIds: ['react-css-module-scope', 'react-hydration-boundary', 'react-jsx-prop-binding', 'react-route-dynamic'],
    requiredConformance: ['C4']
  },
  {
    id: 'svelte',
    detectionPrecedence: ['config-override', 'svelte-file-signature', 'compiler-signals', 'package-signatures', 'heuristic'],
    appliesToLanguages: ['css', 'html', 'javascript', 'typescript'],
    segmentationRules: {
      blocks: ['module-script', 'instance-script', 'template', 'style'],
      ordering: ['container-segmentation', 'virtual-documents', 'parse-blocks', 'emit-local-entities', 'emit-bridge-edges', 'route-style-hydration-enrichment'],
      crossBlockLinking: ['template-script-bridge', 'template-style-bridge']
    },
    bindingSemantics: {
      requiredEdgeKinds: ['template_binds', 'template_emits', 'style_scopes', 'hydration_boundary'],
      requiredAttrs: {
        template_binds: ['bindingKind'],
        template_emits: ['eventKind'],
        style_scopes: ['scopeKind'],
        hydration_boundary: ['runtimeSide']
      }
    },
    routeSemantics: {
      enabled: false,
      patternCanon: 'bracket-form',
      runtimeSides: ['client', 'server', 'universal', 'unknown']
    },
    hydrationSemantics: {
      required: true,
      boundarySignals: ['hydrate', 'svelte-component-boundary'],
      ssrCsrModes: ['ssr', 'csr', 'hybrid']
    },
    embeddedLanguageBridges: [
      { sourceBlock: 'template', targetBlock: 'instance-script', edgeKinds: ['template_binds', 'template_emits'] },
      { sourceBlock: 'template', targetBlock: 'style', edgeKinds: ['style_scopes'] }
    ],
    edgeCaseCaseIds: ['svelte-bind-and-event', 'svelte-slot-props', 'svelte-style-scope'],
    requiredConformance: ['C4']
  },
  {
    id: 'sveltekit',
    detectionPrecedence: ['config-override', 'sveltekit-route-conventions', 'kit-config-signals', 'package-signatures', 'heuristic'],
    appliesToLanguages: ['css', 'html', 'javascript', 'typescript'],
    segmentationRules: {
      blocks: ['module-script', 'instance-script', 'template', 'style', 'route'],
      ordering: ['container-segmentation', 'virtual-documents', 'parse-blocks', 'emit-local-entities', 'emit-bridge-edges', 'route-style-hydration-enrichment'],
      crossBlockLinking: ['route-load-binding', 'template-script-bridge']
    },
    bindingSemantics: {
      requiredEdgeKinds: ['template_binds', 'template_emits', 'style_scopes', 'route_maps_to', 'hydration_boundary'],
      requiredAttrs: {
        template_binds: ['bindingKind'],
        template_emits: ['eventKind'],
        style_scopes: ['scopeKind'],
        route_maps_to: ['routePattern', 'runtimeSide'],
        hydration_boundary: ['runtimeSide']
      }
    },
    routeSemantics: {
      enabled: true,
      patternCanon: 'bracket-form',
      runtimeSides: ['client', 'server', 'universal', 'unknown']
    },
    hydrationSemantics: {
      required: true,
      boundarySignals: ['csr', 'ssr', 'prerender'],
      ssrCsrModes: ['ssr', 'csr', 'hybrid']
    },
    embeddedLanguageBridges: [
      { sourceBlock: 'route', targetBlock: 'instance-script', edgeKinds: ['route_maps_to', 'template_binds'] },
      { sourceBlock: 'template', targetBlock: 'style', edgeKinds: ['style_scopes'] }
    ],
    edgeCaseCaseIds: ['sveltekit-component-style-scope', 'sveltekit-load-data-binding', 'sveltekit-page-data-template', 'sveltekit-route-param', 'sveltekit-server-action-route'],
    requiredConformance: ['C4']
  },
  {
    id: 'vue',
    detectionPrecedence: ['config-override', 'vue-sfc-signature', 'vue-compiler-metadata', 'package-signatures', 'heuristic'],
    appliesToLanguages: ['css', 'html', 'javascript', 'typescript'],
    segmentationRules: {
      blocks: ['template', 'script', 'script-setup', 'style', 'custom'],
      ordering: ['container-segmentation', 'virtual-documents', 'parse-blocks', 'emit-local-entities', 'emit-bridge-edges', 'route-style-hydration-enrichment'],
      crossBlockLinking: ['template-script-bridge', 'template-style-bridge']
    },
    bindingSemantics: {
      requiredEdgeKinds: ['template_binds', 'template_emits', 'style_scopes', 'route_maps_to', 'hydration_boundary'],
      requiredAttrs: {
        template_binds: ['bindingKind'],
        template_emits: ['eventKind'],
        style_scopes: ['scopeKind'],
        route_maps_to: ['routePattern', 'runtimeSide'],
        hydration_boundary: ['runtimeSide']
      }
    },
    routeSemantics: {
      enabled: true,
      patternCanon: 'bracket-form',
      runtimeSides: ['client', 'server', 'universal', 'unknown']
    },
    hydrationSemantics: {
      required: true,
      boundarySignals: ['suspense', 'teleport', 'async-component'],
      ssrCsrModes: ['ssr', 'csr', 'universal']
    },
    embeddedLanguageBridges: [
      { sourceBlock: 'template', targetBlock: 'script-setup', edgeKinds: ['template_binds', 'template_emits'] },
      { sourceBlock: 'template', targetBlock: 'style', edgeKinds: ['style_scopes'] }
    ],
    edgeCaseCaseIds: ['vue-router-dynamic-param', 'vue-sfc-scoped-style', 'vue-sfc-script-setup-bindings'],
    requiredConformance: ['C4']
  }
].sort((a, b) => a.id.localeCompare(b.id));

const frameworkEdgeCases = [
  { id: 'angular-input-output-binding', frameworkProfile: 'angular', category: 'template', requiredEdgeKinds: ['template_binds', 'template_emits'], requiredDiagnostics: [], blocking: true },
  { id: 'angular-route-config-lazy', frameworkProfile: 'angular', category: 'route', requiredEdgeKinds: ['route_maps_to'], requiredDiagnostics: [], blocking: true },
  { id: 'angular-template-style-encapsulation', frameworkProfile: 'angular', category: 'style', requiredEdgeKinds: ['style_scopes'], requiredDiagnostics: [], blocking: true },
  { id: 'astro-component-style-scope', frameworkProfile: 'astro', category: 'style', requiredEdgeKinds: ['style_scopes'], requiredDiagnostics: [], blocking: true },
  { id: 'astro-frontmatter-template-bridge', frameworkProfile: 'astro', category: 'bridge', requiredEdgeKinds: ['template_binds'], requiredDiagnostics: [], blocking: true },
  { id: 'astro-island-hydration', frameworkProfile: 'astro', category: 'hydration', requiredEdgeKinds: ['hydration_boundary'], requiredDiagnostics: [], blocking: true },
  { id: 'astro-route-collection', frameworkProfile: 'astro', category: 'route', requiredEdgeKinds: ['route_maps_to'], requiredDiagnostics: [], blocking: true },
  { id: 'astro-template-slot-props', frameworkProfile: 'astro', category: 'template', requiredEdgeKinds: ['template_binds'], requiredDiagnostics: [], blocking: true },
  { id: 'next-app-router-dynamic-segment', frameworkProfile: 'next', category: 'route', requiredEdgeKinds: ['route_maps_to'], requiredDiagnostics: [], blocking: true },
  { id: 'next-client-server-boundary', frameworkProfile: 'next', category: 'hydration', requiredEdgeKinds: ['hydration_boundary'], requiredDiagnostics: [], blocking: true },
  { id: 'next-css-module-style-scope', frameworkProfile: 'next', category: 'style', requiredEdgeKinds: ['style_scopes'], requiredDiagnostics: [], blocking: true },
  { id: 'next-route-handler-runtime', frameworkProfile: 'next', category: 'route', requiredEdgeKinds: ['route_maps_to'], requiredDiagnostics: [], blocking: true },
  { id: 'next-rsc-template-props', frameworkProfile: 'next', category: 'template', requiredEdgeKinds: ['template_binds'], requiredDiagnostics: [], blocking: true },
  { id: 'nuxt-pages-route-params', frameworkProfile: 'nuxt', category: 'route', requiredEdgeKinds: ['route_maps_to'], requiredDiagnostics: [], blocking: true },
  { id: 'nuxt-server-route-mapping', frameworkProfile: 'nuxt', category: 'route', requiredEdgeKinds: ['route_maps_to'], requiredDiagnostics: [], blocking: true },
  { id: 'nuxt-sfc-style-scope', frameworkProfile: 'nuxt', category: 'style', requiredEdgeKinds: ['style_scopes'], requiredDiagnostics: [], blocking: true },
  { id: 'nuxt-template-composable-binding', frameworkProfile: 'nuxt', category: 'template', requiredEdgeKinds: ['template_binds'], requiredDiagnostics: [], blocking: true },
  { id: 'react-css-module-scope', frameworkProfile: 'react', category: 'style', requiredEdgeKinds: ['style_scopes'], requiredDiagnostics: [], blocking: true },
  { id: 'react-hydration-boundary', frameworkProfile: 'react', category: 'hydration', requiredEdgeKinds: ['hydration_boundary'], requiredDiagnostics: [], blocking: true },
  { id: 'react-jsx-prop-binding', frameworkProfile: 'react', category: 'template', requiredEdgeKinds: ['template_binds'], requiredDiagnostics: [], blocking: true },
  { id: 'react-route-dynamic', frameworkProfile: 'react', category: 'route', requiredEdgeKinds: ['route_maps_to'], requiredDiagnostics: [], blocking: true },
  { id: 'svelte-bind-and-event', frameworkProfile: 'svelte', category: 'template', requiredEdgeKinds: ['template_binds', 'template_emits'], requiredDiagnostics: [], blocking: true },
  { id: 'svelte-slot-props', frameworkProfile: 'svelte', category: 'template', requiredEdgeKinds: ['template_binds'], requiredDiagnostics: [], blocking: true },
  { id: 'svelte-style-scope', frameworkProfile: 'svelte', category: 'style', requiredEdgeKinds: ['style_scopes'], requiredDiagnostics: [], blocking: true },
  { id: 'sveltekit-component-style-scope', frameworkProfile: 'sveltekit', category: 'style', requiredEdgeKinds: ['style_scopes'], requiredDiagnostics: [], blocking: true },
  { id: 'sveltekit-load-data-binding', frameworkProfile: 'sveltekit', category: 'route', requiredEdgeKinds: ['route_maps_to', 'template_binds'], requiredDiagnostics: [], blocking: true },
  { id: 'sveltekit-page-data-template', frameworkProfile: 'sveltekit', category: 'template', requiredEdgeKinds: ['template_binds'], requiredDiagnostics: [], blocking: true },
  { id: 'sveltekit-route-param', frameworkProfile: 'sveltekit', category: 'route', requiredEdgeKinds: ['route_maps_to'], requiredDiagnostics: [], blocking: true },
  { id: 'sveltekit-server-action-route', frameworkProfile: 'sveltekit', category: 'route', requiredEdgeKinds: ['route_maps_to'], requiredDiagnostics: [], blocking: true },
  { id: 'vue-router-dynamic-param', frameworkProfile: 'vue', category: 'route', requiredEdgeKinds: ['route_maps_to'], requiredDiagnostics: [], blocking: true },
  { id: 'vue-sfc-scoped-style', frameworkProfile: 'vue', category: 'style', requiredEdgeKinds: ['style_scopes'], requiredDiagnostics: [], blocking: true },
  { id: 'vue-sfc-script-setup-bindings', frameworkProfile: 'vue', category: 'template', requiredEdgeKinds: ['template_binds', 'template_emits'], requiredDiagnostics: [], blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const edgeKindConstraints = [
  { edgeKind: 'ast_parent', sourceEntityKinds: ['node'], targetEntityKinds: ['node'], requiredAttrs: [], optionalAttrs: [], blocking: true },
  { edgeKind: 'calls', sourceEntityKinds: ['node', 'symbol'], targetEntityKinds: ['node', 'symbol'], requiredAttrs: [], optionalAttrs: ['confidence'], blocking: true },
  { edgeKind: 'contains', sourceEntityKinds: ['document', 'node', 'segment'], targetEntityKinds: ['node', 'segment', 'symbol'], requiredAttrs: [], optionalAttrs: [], blocking: true },
  { edgeKind: 'control_next', sourceEntityKinds: ['node'], targetEntityKinds: ['node'], requiredAttrs: [], optionalAttrs: ['branchType'], blocking: true },
  { edgeKind: 'data_def_use', sourceEntityKinds: ['node', 'symbol'], targetEntityKinds: ['node', 'symbol'], requiredAttrs: [], optionalAttrs: ['flowLabel'], blocking: true },
  { edgeKind: 'declares', sourceEntityKinds: ['node'], targetEntityKinds: ['symbol'], requiredAttrs: [], optionalAttrs: [], blocking: true },
  { edgeKind: 'defines', sourceEntityKinds: ['node'], targetEntityKinds: ['symbol'], requiredAttrs: [], optionalAttrs: [], blocking: true },
  { edgeKind: 'exports', sourceEntityKinds: ['node', 'symbol'], targetEntityKinds: ['document', 'symbol'], requiredAttrs: [], optionalAttrs: [], blocking: true },
  { edgeKind: 'extends', sourceEntityKinds: ['symbol'], targetEntityKinds: ['symbol'], requiredAttrs: [], optionalAttrs: [], blocking: true },
  { edgeKind: 'hydration_boundary', sourceEntityKinds: ['node', 'symbol'], targetEntityKinds: ['node', 'symbol'], requiredAttrs: ['runtimeSide'], optionalAttrs: ['boundarySignal'], blocking: true },
  { edgeKind: 'implements', sourceEntityKinds: ['symbol'], targetEntityKinds: ['symbol'], requiredAttrs: [], optionalAttrs: [], blocking: true },
  { edgeKind: 'imports', sourceEntityKinds: ['document', 'node', 'segment'], targetEntityKinds: ['document', 'segment', 'symbol'], requiredAttrs: [], optionalAttrs: ['importKind'], blocking: true },
  { edgeKind: 'references', sourceEntityKinds: ['node', 'symbol'], targetEntityKinds: ['node', 'symbol'], requiredAttrs: [], optionalAttrs: ['confidence'], blocking: true },
  { edgeKind: 'risk_flow', sourceEntityKinds: ['node', 'symbol'], targetEntityKinds: ['node', 'symbol'], requiredAttrs: ['riskClass'], optionalAttrs: ['pathId'], blocking: true },
  { edgeKind: 'risk_sink', sourceEntityKinds: ['node', 'symbol'], targetEntityKinds: ['node', 'symbol'], requiredAttrs: ['riskClass'], optionalAttrs: [], blocking: true },
  { edgeKind: 'risk_source', sourceEntityKinds: ['node', 'symbol'], targetEntityKinds: ['node', 'symbol'], requiredAttrs: ['riskClass'], optionalAttrs: [], blocking: true },
  { edgeKind: 'route_maps_to', sourceEntityKinds: ['node', 'symbol'], targetEntityKinds: ['document', 'symbol'], requiredAttrs: ['routePattern', 'runtimeSide'], optionalAttrs: ['httpMethod'], blocking: true },
  { edgeKind: 'sanitizes', sourceEntityKinds: ['node', 'symbol'], targetEntityKinds: ['node', 'symbol'], requiredAttrs: ['sanitizerClass'], optionalAttrs: [], blocking: true },
  { edgeKind: 'style_scopes', sourceEntityKinds: ['node', 'segment'], targetEntityKinds: ['symbol'], requiredAttrs: ['scopeKind'], optionalAttrs: ['moduleName'], blocking: true },
  { edgeKind: 'template_binds', sourceEntityKinds: ['node', 'segment'], targetEntityKinds: ['node', 'symbol'], requiredAttrs: ['bindingKind'], optionalAttrs: ['bridgeConfidence'], blocking: true },
  { edgeKind: 'template_emits', sourceEntityKinds: ['node', 'segment'], targetEntityKinds: ['node', 'symbol'], requiredAttrs: ['eventKind'], optionalAttrs: ['bridgeConfidence'], blocking: true },
  { edgeKind: 'uses_type', sourceEntityKinds: ['node', 'symbol'], targetEntityKinds: ['node', 'symbol'], requiredAttrs: [], optionalAttrs: ['typeRole'], blocking: true }
].sort((a, b) => a.edgeKind.localeCompare(b.edgeKind));

const nodeKindMappings = [
  { languageId: '*', parserSource: '*', rawKind: 'ClassDeclaration', normalizedKind: 'class_decl', category: 'declaration', confidence: 1, priority: 10, provenance: 'manual-policy', languageVersionSelector: null, notes: 'Global class declaration baseline.' },
  { languageId: '*', parserSource: '*', rawKind: 'FunctionDeclaration', normalizedKind: 'function_decl', category: 'declaration', confidence: 1, priority: 10, provenance: 'manual-policy', languageVersionSelector: null, notes: 'Global function declaration baseline.' },
  { languageId: '*', parserSource: '*', rawKind: 'Identifier', normalizedKind: 'identifier', category: 'expression', confidence: 1, priority: 20, provenance: 'manual-policy', languageVersionSelector: null, notes: 'Global identifier baseline.' },
  { languageId: '*', parserSource: '*', rawKind: 'ImportDeclaration', normalizedKind: 'import_stmt', category: 'module', confidence: 1, priority: 10, provenance: 'manual-policy', languageVersionSelector: null, notes: 'Global import baseline.' },
  { languageId: '*', parserSource: '*', rawKind: 'MethodDefinition', normalizedKind: 'method_decl', category: 'declaration', confidence: 1, priority: 10, provenance: 'manual-policy', languageVersionSelector: null, notes: 'Global method baseline.' },
  { languageId: '*', parserSource: '*', rawKind: 'VariableDeclaration', normalizedKind: 'variable_decl', category: 'declaration', confidence: 1, priority: 10, provenance: 'manual-policy', languageVersionSelector: null, notes: 'Global variable baseline.' },
  { languageId: '*', parserSource: 'framework-compiler', rawKind: 'AstroFrontmatter', normalizedKind: 'directive_expr', category: 'template', confidence: 0.95, priority: 5, provenance: 'compiler', languageVersionSelector: null, notes: 'Astro frontmatter overlay mapping.' },
  { languageId: '*', parserSource: 'framework-compiler', rawKind: 'NgTemplateBinding', normalizedKind: 'directive_expr', category: 'template', confidence: 0.95, priority: 5, provenance: 'compiler', languageVersionSelector: null, notes: 'Angular template compiler binding mapping.' },
  { languageId: '*', parserSource: 'framework-compiler', rawKind: 'SvelteElement', normalizedKind: 'template_element', category: 'template', confidence: 0.95, priority: 5, provenance: 'compiler', languageVersionSelector: null, notes: 'Svelte compiler template element mapping.' },
  { languageId: '*', parserSource: 'framework-compiler', rawKind: 'VueTemplateElement', normalizedKind: 'template_element', category: 'template', confidence: 0.95, priority: 5, provenance: 'compiler', languageVersionSelector: null, notes: 'Vue compiler template element mapping.' },
  { languageId: '*', parserSource: 'tree-sitter', rawKind: 'call_expression', normalizedKind: 'call_expr', category: 'expression', confidence: 1, priority: 10, provenance: 'parser', languageVersionSelector: null, notes: 'Tree-sitter call expression baseline.' },
  { languageId: '*', parserSource: 'tree-sitter', rawKind: 'function_definition', normalizedKind: 'function_decl', category: 'declaration', confidence: 1, priority: 10, provenance: 'parser', languageVersionSelector: null, notes: 'Tree-sitter function baseline.' },
  { languageId: 'javascript', parserSource: 'native-parser', rawKind: 'JSXElement', normalizedKind: 'template_element', category: 'template', confidence: 1, priority: 2, provenance: 'parser', languageVersionSelector: null, notes: 'JSX mapping.' },
  { languageId: 'typescript', parserSource: 'native-parser', rawKind: 'TSInterfaceDeclaration', normalizedKind: 'interface_decl', category: 'declaration', confidence: 1, priority: 2, provenance: 'parser', languageVersionSelector: null, notes: 'TypeScript interface mapping.' }
].sort((a, b) => {
  if (a.languageId !== b.languageId) return a.languageId.localeCompare(b.languageId);
  if (a.parserSource !== b.parserSource) return a.parserSource.localeCompare(b.parserSource);
  if (a.rawKind !== b.rawKind) return a.rawKind.localeCompare(b.rawKind);
  return a.priority - b.priority;
});

const backcompatMatrix = [
  { id: 'BC-001', producerVersion: 'usr-1.0.0', readerVersions: ['usr-1.0.0'], readerMode: 'strict', fixtureFamily: 'language-core', expectedOutcome: 'accept', requiredDiagnostics: [], blocking: true },
  { id: 'BC-002', producerVersion: 'usr-1.0.0', readerVersions: ['usr-1.1.0'], readerMode: 'strict', fixtureFamily: 'framework-overlay', expectedOutcome: 'accept', requiredDiagnostics: [], blocking: true },
  { id: 'BC-003', producerVersion: 'usr-1.1.0', readerVersions: ['usr-1.0.0'], readerMode: 'strict', fixtureFamily: 'language-core', expectedOutcome: 'reject', requiredDiagnostics: ['USR-E-SCHEMA-VIOLATION'], blocking: true },
  { id: 'BC-004', producerVersion: 'usr-1.1.0', readerVersions: ['usr-1.0.0'], readerMode: 'non-strict', fixtureFamily: 'language-core', expectedOutcome: 'accept-with-adapter', requiredDiagnostics: ['USR-W-BACKCOMPAT-ADAPTER'], blocking: false },
  { id: 'BC-005', producerVersion: 'usr-1.0.0', readerVersions: ['usr-1.0.0', 'usr-1.1.0'], readerMode: 'strict', fixtureFamily: 'degraded-capability', expectedOutcome: 'accept', requiredDiagnostics: ['USR-W-CAPABILITY-DOWNGRADED'], blocking: true },
  { id: 'BC-006', producerVersion: 'usr-1.1.0', readerVersions: ['usr-1.0.0'], readerMode: 'strict', fixtureFamily: 'enum-change', expectedOutcome: 'reject', requiredDiagnostics: ['USR-E-SCHEMA-VIOLATION'], blocking: true },
  { id: 'BC-007', producerVersion: 'usr-1.1.0', readerVersions: ['usr-1.0.0'], readerMode: 'non-strict', fixtureFamily: 'enum-change', expectedOutcome: 'accept-with-adapter', requiredDiagnostics: ['USR-W-BACKCOMPAT-ADAPTER'], blocking: false },
  { id: 'BC-008', producerVersion: 'usr-1.1.0', readerVersions: ['usr-1.0.0'], readerMode: 'strict', fixtureFamily: 'required-field-removal', expectedOutcome: 'reject', requiredDiagnostics: ['USR-E-SCHEMA-VIOLATION'], blocking: true },
  { id: 'BC-009', producerVersion: 'usr-1.0.0', readerVersions: ['usr-1.0.0'], readerMode: 'strict', fixtureFamily: 'coordinate-corruption', expectedOutcome: 'reject', requiredDiagnostics: ['USR-E-SCHEMA-VIOLATION'], blocking: true },
  { id: 'BC-010', producerVersion: 'usr-1.1.0', readerVersions: ['usr-1.0.0'], readerMode: 'strict', fixtureFamily: 'reason-code-expansion', expectedOutcome: 'reject', requiredDiagnostics: ['USR-E-SCHEMA-VIOLATION'], blocking: true },
  { id: 'BC-011', producerVersion: 'usr-1.1.0', readerVersions: ['usr-1.0.0'], readerMode: 'non-strict', fixtureFamily: 'reason-code-expansion', expectedOutcome: 'accept-with-adapter', requiredDiagnostics: ['USR-W-BACKCOMPAT-ADAPTER'], blocking: false },
  { id: 'BC-012', producerVersion: 'usr-1.0.0', readerVersions: ['usr-1.0.0'], readerMode: 'strict', fixtureFamily: 'edge-endpoint-violation', expectedOutcome: 'reject', requiredDiagnostics: ['USR-E-EDGE-ENDPOINT-CONSTRAINT'], blocking: true }
];

const embeddingBridgeCases = [
  { id: 'bridge-angular-component-template', containerKind: 'angular-component', sourceLanguageId: 'typescript', targetLanguageId: 'html', requiredEdgeKinds: ['template_binds', 'template_emits'], requiredDiagnostics: [], blocking: true },
  { id: 'bridge-astro-frontmatter-template', containerKind: 'astro', sourceLanguageId: 'typescript', targetLanguageId: 'html', requiredEdgeKinds: ['template_binds'], requiredDiagnostics: [], blocking: true },
  { id: 'bridge-astro-template-style', containerKind: 'astro', sourceLanguageId: 'html', targetLanguageId: 'css', requiredEdgeKinds: ['style_scopes'], requiredDiagnostics: [], blocking: true },
  { id: 'bridge-html-inline-script', containerKind: 'html-inline', sourceLanguageId: 'html', targetLanguageId: 'javascript', requiredEdgeKinds: ['template_binds'], requiredDiagnostics: ['USR-W-BRIDGE-PARTIAL'], blocking: false },
  { id: 'bridge-razor-template-csharp', containerKind: 'razor', sourceLanguageId: 'razor', targetLanguageId: 'csharp', requiredEdgeKinds: ['template_binds'], requiredDiagnostics: [], blocking: true },
  { id: 'bridge-svelte-template-style', containerKind: 'svelte', sourceLanguageId: 'html', targetLanguageId: 'css', requiredEdgeKinds: ['style_scopes'], requiredDiagnostics: [], blocking: true },
  { id: 'bridge-svelte-template-typescript', containerKind: 'svelte', sourceLanguageId: 'html', targetLanguageId: 'typescript', requiredEdgeKinds: ['template_binds', 'template_emits'], requiredDiagnostics: [], blocking: true },
  { id: 'bridge-vue-template-script', containerKind: 'vue-sfc', sourceLanguageId: 'html', targetLanguageId: 'typescript', requiredEdgeKinds: ['template_binds', 'template_emits'], requiredDiagnostics: [], blocking: true },
  { id: 'bridge-vue-template-style', containerKind: 'vue-sfc', sourceLanguageId: 'html', targetLanguageId: 'css', requiredEdgeKinds: ['style_scopes'], requiredDiagnostics: [], blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const generatedProvenanceCases = [
  { id: 'prov-angular-template-compiler', languageId: 'typescript', generationKind: 'framework-compiler', mappingExpectation: 'approximate', requiredDiagnostics: ['USR-W-PROVENANCE-APPROXIMATE'], blocking: false },
  { id: 'prov-astro-island-generated', languageId: 'javascript', generationKind: 'framework-compiler', mappingExpectation: 'approximate', requiredDiagnostics: ['USR-W-PROVENANCE-APPROXIMATE'], blocking: false },
  { id: 'prov-clike-preprocessor', languageId: 'clike', generationKind: 'macro', mappingExpectation: 'approximate', requiredDiagnostics: ['USR-W-PROVENANCE-APPROXIMATE'], blocking: false },
  { id: 'prov-go-codegen', languageId: 'go', generationKind: 'codegen', mappingExpectation: 'exact', requiredDiagnostics: [], blocking: true },
  { id: 'prov-javascript-babel-output', languageId: 'javascript', generationKind: 'transpile', mappingExpectation: 'approximate', requiredDiagnostics: ['USR-W-PROVENANCE-APPROXIMATE'], blocking: false },
  { id: 'prov-proto-stub-generated', languageId: 'proto', generationKind: 'codegen', mappingExpectation: 'exact', requiredDiagnostics: [], blocking: true },
  { id: 'prov-rust-macro-expand', languageId: 'rust', generationKind: 'macro', mappingExpectation: 'approximate', requiredDiagnostics: ['USR-W-PROVENANCE-APPROXIMATE'], blocking: false },
  { id: 'prov-svelte-compiler-output', languageId: 'typescript', generationKind: 'framework-compiler', mappingExpectation: 'approximate', requiredDiagnostics: ['USR-W-PROVENANCE-APPROXIMATE'], blocking: false },
  { id: 'prov-typescript-transpile-js', languageId: 'typescript', generationKind: 'transpile', mappingExpectation: 'exact', requiredDiagnostics: [], blocking: true },
  { id: 'prov-vue-sfc-compiler', languageId: 'typescript', generationKind: 'framework-compiler', mappingExpectation: 'approximate', requiredDiagnostics: ['USR-W-PROVENANCE-APPROXIMATE'], blocking: false }
].sort((a, b) => a.id.localeCompare(b.id));

const parserRuntimeLocks = [
  { parserSource: 'framework-compiler', languageId: '*', parserName: 'framework-compiler-baseline', parserVersion: '1.0.0', runtimeName: 'node', runtimeVersion: '20.x', lockReason: 'framework-compiler-baseline', maxUpgradeBudgetDays: 45 },
  { parserSource: 'heuristic', languageId: '*', parserName: 'heuristic-fallback-baseline', parserVersion: '1.0.0', runtimeName: 'node', runtimeVersion: '20.x', lockReason: 'fallback-safety-net', maxUpgradeBudgetDays: 90 },
  { parserSource: 'hybrid', languageId: '*', parserName: 'hybrid-parser-baseline', parserVersion: '1.0.0', runtimeName: 'node', runtimeVersion: '20.x', lockReason: 'hybrid-chain-lock', maxUpgradeBudgetDays: 75 },
  { parserSource: 'native-parser', languageId: '*', parserName: 'native-parser-baseline', parserVersion: '1.0.0', runtimeName: 'node', runtimeVersion: '20.x', lockReason: 'primary-parser-lock', maxUpgradeBudgetDays: 30 },
  { parserSource: 'tooling', languageId: '*', parserName: 'tooling-adapter-baseline', parserVersion: '1.0.0', runtimeName: 'node', runtimeVersion: '20.x', lockReason: 'tooling-adapter-lock', maxUpgradeBudgetDays: 60 },
  { parserSource: 'tree-sitter', languageId: '*', parserName: 'tree-sitter-core', parserVersion: '0.22.0', runtimeName: 'node-tree-sitter', runtimeVersion: '0.21.x', lockReason: 'tree-sitter-lock', maxUpgradeBudgetDays: 30 }
].sort((a, b) => {
  if (a.parserSource !== b.parserSource) return a.parserSource.localeCompare(b.parserSource);
  return a.languageId.localeCompare(b.languageId);
});

const sloBudgets = [
  { laneId: 'ci', profileScope: 'global', scopeId: 'global', maxDurationMs: 1200000, maxMemoryMb: 4096, maxParserTimePerSegmentMs: 1500, maxUnknownKindRate: 0.02, maxUnresolvedRate: 0.02, blocking: true },
  { laneId: 'ci-long', profileScope: 'global', scopeId: 'global', maxDurationMs: 2000000, maxMemoryMb: 8192, maxParserTimePerSegmentMs: 2000, maxUnknownKindRate: 0.02, maxUnresolvedRate: 0.02, blocking: true },
  { laneId: 'lang-batch-javascript-typescript', profileScope: 'batch', scopeId: 'B1', maxDurationMs: 600000, maxMemoryMb: 3072, maxParserTimePerSegmentMs: 1200, maxUnknownKindRate: 0.015, maxUnresolvedRate: 0.015, blocking: true },
  { laneId: 'lang-batch-systems-languages', profileScope: 'batch', scopeId: 'B2', maxDurationMs: 600000, maxMemoryMb: 3072, maxParserTimePerSegmentMs: 1200, maxUnknownKindRate: 0.015, maxUnresolvedRate: 0.015, blocking: true },
  { laneId: 'lang-batch-managed-languages', profileScope: 'batch', scopeId: 'B3', maxDurationMs: 600000, maxMemoryMb: 3072, maxParserTimePerSegmentMs: 1200, maxUnknownKindRate: 0.015, maxUnresolvedRate: 0.015, blocking: true },
  { laneId: 'lang-batch-dynamic-languages', profileScope: 'batch', scopeId: 'B4', maxDurationMs: 600000, maxMemoryMb: 3072, maxParserTimePerSegmentMs: 1200, maxUnknownKindRate: 0.015, maxUnresolvedRate: 0.015, blocking: true },
  { laneId: 'lang-batch-markup-style-template', profileScope: 'batch', scopeId: 'B5', maxDurationMs: 600000, maxMemoryMb: 3072, maxParserTimePerSegmentMs: 1200, maxUnknownKindRate: 0.015, maxUnresolvedRate: 0.015, blocking: true },
  { laneId: 'lang-batch-data-interface-dsl', profileScope: 'batch', scopeId: 'B6', maxDurationMs: 600000, maxMemoryMb: 3072, maxParserTimePerSegmentMs: 1200, maxUnknownKindRate: 0.015, maxUnresolvedRate: 0.015, blocking: true },
  { laneId: 'lang-batch-build-infra-dsl', profileScope: 'batch', scopeId: 'B7', maxDurationMs: 600000, maxMemoryMb: 3072, maxParserTimePerSegmentMs: 1200, maxUnknownKindRate: 0.015, maxUnresolvedRate: 0.015, blocking: true },
  { laneId: 'lang-framework-canonicalization', profileScope: 'framework', scopeId: 'C4', maxDurationMs: 900000, maxMemoryMb: 4096, maxParserTimePerSegmentMs: 1500, maxUnknownKindRate: 0.02, maxUnresolvedRate: 0.02, blocking: true },
  { laneId: 'lang-smoke', profileScope: 'global', scopeId: 'global', maxDurationMs: 180000, maxMemoryMb: 2048, maxParserTimePerSegmentMs: 800, maxUnknownKindRate: 0.03, maxUnresolvedRate: 0.03, blocking: true }
].sort((a, b) => a.laneId.localeCompare(b.laneId));

const alertPolicies = [
  { id: 'alert-capability-downgrade-rate', metric: 'capability_downgrade_rate', threshold: 0.01, comparator: '>', window: '7d', severity: 'warning', escalationPolicyId: 'usr-oncall-language', blocking: false },
  { id: 'alert-critical-diagnostics', metric: 'critical_diagnostic_count', threshold: 0, comparator: '>', window: 'run', severity: 'critical', escalationPolicyId: 'usr-oncall-platform', blocking: true },
  { id: 'alert-lane-duration', metric: 'lane_duration_ms', threshold: 1200000, comparator: '>', window: 'run', severity: 'critical', escalationPolicyId: 'usr-oncall-platform', blocking: true },
  { id: 'alert-memory-peak', metric: 'lane_peak_memory_mb', threshold: 4096, comparator: '>', window: 'run', severity: 'critical', escalationPolicyId: 'usr-oncall-platform', blocking: true },
  { id: 'alert-redaction-failure', metric: 'redaction_failure_count', threshold: 0, comparator: '>', window: 'run', severity: 'critical', escalationPolicyId: 'usr-oncall-security', blocking: true },
  { id: 'alert-unresolved-rate', metric: 'unresolved_reference_rate', threshold: 0.02, comparator: '>', window: 'run', severity: 'critical', escalationPolicyId: 'usr-oncall-language', blocking: true },
  { id: 'alert-unknown-kind-rate', metric: 'unknown_kind_rate', threshold: 0.02, comparator: '>', window: 'run', severity: 'critical', escalationPolicyId: 'usr-oncall-language', blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const redactionRules = [
  { id: 'redact-auth-token', class: 'auth-token', replacement: '[REDACTED_TOKEN]', appliesTo: ['diagnostic.message', 'node.text', 'report.payload'], blocking: true },
  { id: 'redact-cookie', class: 'cookie', replacement: '[REDACTED_COOKIE]', appliesTo: ['diagnostic.message', 'report.payload'], blocking: true },
  { id: 'redact-email', class: 'email', replacement: '[REDACTED_EMAIL]', appliesTo: ['diagnostic.message', 'report.payload'], blocking: true },
  { id: 'redact-filepath', class: 'filesystem-path-sensitive', replacement: '[REDACTED_PATH]', appliesTo: ['diagnostic.message', 'report.payload'], blocking: false },
  { id: 'redact-ipv4', class: 'ip-address', replacement: '[REDACTED_IP]', appliesTo: ['diagnostic.message', 'report.payload'], blocking: true },
  { id: 'redact-private-key', class: 'private-key-material', replacement: '[REDACTED_KEY]', appliesTo: ['diagnostic.message', 'report.payload'], blocking: true },
  { id: 'redact-session-id', class: 'session-id', replacement: '[REDACTED_SESSION]', appliesTo: ['diagnostic.message', 'report.payload'], blocking: true },
  { id: 'redact-url-secret-param', class: 'url-secret-param', replacement: '[REDACTED_PARAM]', appliesTo: ['diagnostic.message', 'report.payload'], blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const securityGates = [
  { id: 'security-gate-parser-lock', check: 'parser_runtime_versions_pinned', scope: 'parser', enforcement: 'strict', blocking: true },
  { id: 'security-gate-path-traversal', check: 'path_traversal_rejected', scope: 'path', enforcement: 'strict', blocking: true },
  { id: 'security-gate-redaction-complete', check: 'redaction_rules_applied', scope: 'reporting', enforcement: 'strict', blocking: true },
  { id: 'security-gate-report-size-cap', check: 'report_payload_size_within_cap', scope: 'reporting', enforcement: 'warn', blocking: false },
  { id: 'security-gate-runtime-sandbox', check: 'runtime_exec_disallowed', scope: 'runtime', enforcement: 'strict', blocking: true },
  { id: 'security-gate-schema-no-extension', check: 'strict_schema_unknown_keys_rejected', scope: 'serialization', enforcement: 'strict', blocking: true },
  { id: 'security-gate-symlink-deny', check: 'symlink_escape_denied', scope: 'path', enforcement: 'strict', blocking: true },
  { id: 'security-gate-unsafe-parser-feature', check: 'unsafe_parser_features_disabled', scope: 'parser', enforcement: 'strict', blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const runtimeConfigPolicy = [
  { id: 'cfg-fallback-allow-heuristic', key: 'usr.fallback.allowHeuristic', valueType: 'boolean', defaultValue: true, rolloutClass: 'stable', strictModeBehavior: 'disallow', requiresRestart: false, blocking: true },
  { id: 'cfg-framework-enable-overlays', key: 'usr.framework.enableOverlays', valueType: 'boolean', defaultValue: true, rolloutClass: 'stable', strictModeBehavior: 'disallow', requiresRestart: false, blocking: true },
  { id: 'cfg-parser-max-segment-ms', key: 'usr.parser.maxSegmentMs', valueType: 'integer', defaultValue: 1500, minValue: 100, maxValue: 10000, rolloutClass: 'stable', strictModeBehavior: 'disallow', requiresRestart: false, blocking: true },
  { id: 'cfg-parser-selection-mode', key: 'usr.parser.selectionMode', valueType: 'enum', defaultValue: 'deterministic', allowedValues: ['deterministic'], rolloutClass: 'stable', strictModeBehavior: 'disallow', requiresRestart: true, blocking: true },
  { id: 'cfg-reporting-emit-raw-parser-kinds', key: 'usr.reporting.emitRawParserKinds', valueType: 'boolean', defaultValue: true, rolloutClass: 'stable', strictModeBehavior: 'warn-unknown', requiresRestart: false, blocking: false },
  { id: 'cfg-risk-interprocedural-enabled', key: 'usr.risk.interproceduralEnabled', valueType: 'boolean', defaultValue: true, rolloutClass: 'stable', strictModeBehavior: 'disallow', requiresRestart: false, blocking: true },
  { id: 'cfg-rollout-cutover-enabled', key: 'usr.rollout.cutoverEnabled', valueType: 'boolean', defaultValue: false, rolloutClass: 'migration-only', strictModeBehavior: 'disallow', requiresRestart: true, blocking: true },
  { id: 'cfg-rollout-shadow-read-enabled', key: 'usr.rollout.shadowReadEnabled', valueType: 'boolean', defaultValue: true, rolloutClass: 'migration-only', strictModeBehavior: 'disallow', requiresRestart: false, blocking: true },
  { id: 'cfg-strict-mode-enabled', key: 'usr.strictMode.enabled', valueType: 'boolean', defaultValue: true, rolloutClass: 'stable', strictModeBehavior: 'disallow', requiresRestart: false, blocking: true }
].sort((a, b) => a.key.localeCompare(b.key));

const failureInjectionMatrix = [
  { id: 'fi-mapping-conflict', faultClass: 'mapping-conflict', injectionLayer: 'normalization', strictExpectedOutcome: 'fail-closed', nonStrictExpectedOutcome: 'degrade-with-diagnostics', requiredDiagnostics: ['USR-E-SCHEMA-VIOLATION'], requiredReasonCodes: ['USR-R-RESOLUTION-CONFLICT'], rollbackTriggerConsecutiveFailures: 1, requiredRecoveryArtifacts: ['usr-failure-injection-report.json', 'usr-rollback-drill-report.json'], blocking: true },
  { id: 'fi-parser-timeout', faultClass: 'parser-timeout', injectionLayer: 'parser', strictExpectedOutcome: 'degrade-with-diagnostics', nonStrictExpectedOutcome: 'degrade-with-diagnostics', requiredDiagnostics: ['USR-W-CAPABILITY-DOWNGRADED'], requiredReasonCodes: ['USR-R-PARSER-TIMEOUT'], rollbackTriggerConsecutiveFailures: 2, requiredRecoveryArtifacts: ['usr-failure-injection-report.json', 'usr-rollback-drill-report.json'], blocking: true },
  { id: 'fi-parser-unavailable', faultClass: 'parser-unavailable', injectionLayer: 'parser', strictExpectedOutcome: 'degrade-with-diagnostics', nonStrictExpectedOutcome: 'degrade-with-diagnostics', requiredDiagnostics: ['USR-E-CAPABILITY-LOST'], requiredReasonCodes: ['USR-R-PARSER-UNAVAILABLE'], rollbackTriggerConsecutiveFailures: 1, requiredRecoveryArtifacts: ['usr-failure-injection-report.json', 'usr-rollback-drill-report.json'], blocking: true },
  { id: 'fi-redaction-failure', faultClass: 'redaction-failure', injectionLayer: 'reporting', strictExpectedOutcome: 'fail-closed', nonStrictExpectedOutcome: 'degrade-with-diagnostics', requiredDiagnostics: ['USR-E-SECURITY-GATE-FAILED'], requiredReasonCodes: ['USR-R-REDACTION-REQUIRED'], rollbackTriggerConsecutiveFailures: 1, requiredRecoveryArtifacts: ['usr-failure-injection-report.json', 'usr-rollback-drill-report.json'], blocking: true },
  { id: 'fi-resource-budget-breach', faultClass: 'resource-budget-breach', injectionLayer: 'runtime', strictExpectedOutcome: 'fail-closed', nonStrictExpectedOutcome: 'degrade-with-diagnostics', requiredDiagnostics: ['USR-E-SLO-BUDGET-FAILED'], requiredReasonCodes: ['USR-R-RESOURCE-BUDGET-EXCEEDED'], rollbackTriggerConsecutiveFailures: 1, requiredRecoveryArtifacts: ['usr-failure-injection-report.json', 'usr-rollback-drill-report.json'], blocking: true },
  { id: 'fi-resolution-ambiguity-overflow', faultClass: 'resolution-ambiguity-overflow', injectionLayer: 'resolution', strictExpectedOutcome: 'degrade-with-diagnostics', nonStrictExpectedOutcome: 'warn-only', requiredDiagnostics: ['USR-W-RESOLUTION-CANDIDATE-CAPPED'], requiredReasonCodes: ['USR-R-CANDIDATE-CAP-EXCEEDED'], rollbackTriggerConsecutiveFailures: 3, requiredRecoveryArtifacts: ['usr-failure-injection-report.json', 'usr-rollback-drill-report.json'], blocking: true },
  { id: 'fi-security-gate-failure', faultClass: 'security-gate-failure', injectionLayer: 'runtime', strictExpectedOutcome: 'fail-closed', nonStrictExpectedOutcome: 'degrade-with-diagnostics', requiredDiagnostics: ['USR-E-SECURITY-GATE-FAILED'], requiredReasonCodes: ['USR-R-SECURITY-GATE-BLOCKED'], rollbackTriggerConsecutiveFailures: 1, requiredRecoveryArtifacts: ['usr-failure-injection-report.json', 'usr-rollback-drill-report.json'], blocking: true },
  { id: 'fi-serialization-corruption', faultClass: 'serialization-corruption', injectionLayer: 'serialization', strictExpectedOutcome: 'fail-closed', nonStrictExpectedOutcome: 'degrade-with-diagnostics', requiredDiagnostics: ['USR-E-SCHEMA-VIOLATION'], requiredReasonCodes: ['USR-R-SERIALIZATION-INVALID'], rollbackTriggerConsecutiveFailures: 1, requiredRecoveryArtifacts: ['usr-failure-injection-report.json', 'usr-rollback-drill-report.json'], blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const fixtureGovernanceSupplementalRows = [
  { fixtureId: 'angular::template-binding::input-output-001', profileType: 'framework', profileId: 'angular', conformanceLevels: ['C4'], families: ['framework-overlay', 'template-binding'], owner: 'framework-angular', reviewers: ['usr-architecture', 'usr-conformance'], stabilityClass: 'stable', mutationPolicy: 'require-review', goldenRequired: true, blocking: true },
  { fixtureId: 'astro::hydration::island-001', profileType: 'framework', profileId: 'astro', conformanceLevels: ['C4'], families: ['framework-overlay', 'hydration'], owner: 'framework-astro', reviewers: ['usr-architecture', 'usr-conformance'], stabilityClass: 'stable', mutationPolicy: 'require-review', goldenRequired: true, blocking: true },
  { fixtureId: 'javascript::normalization::jsx-element-001', profileType: 'language', profileId: 'javascript', conformanceLevels: ['C0', 'C1', 'C2'], families: ['normalization', 'golden'], owner: 'language-javascript', reviewers: ['usr-conformance'], stabilityClass: 'stable', mutationPolicy: 'require-review', goldenRequired: true, blocking: true },
  { fixtureId: 'typescript::provenance::transpile-001', profileType: 'language', profileId: 'typescript', conformanceLevels: ['C2', 'C3', 'C4'], families: ['provenance', 'golden'], owner: 'language-typescript', reviewers: ['usr-conformance', 'usr-architecture'], stabilityClass: 'stable', mutationPolicy: 'require-rfc', goldenRequired: true, blocking: true },
  { fixtureId: 'typescript::minimum-slice::vue-module-001', profileType: 'language', profileId: 'typescript', conformanceLevels: ['C0', 'C1', 'C2', 'C3', 'C4'], families: ['minimum-slice', 'golden', 'framework-overlay'], owner: 'language-typescript', reviewers: ['usr-architecture', 'usr-conformance'], stabilityClass: 'stable', mutationPolicy: 'require-review', goldenRequired: true, blocking: true },
  { fixtureId: 'usr::backcompat::bc-003', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C0', 'C1'], families: ['backcompat', 'negative'], owner: 'usr-rollout', reviewers: ['usr-architecture', 'usr-conformance'], stabilityClass: 'stable', mutationPolicy: 'require-rfc', goldenRequired: false, blocking: true },
  { fixtureId: 'usr::integration::cross-language-framework-001', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C1', 'C2', 'C4'], families: ['integration', 'semantic-flow', 'framework-overlay', 'route-semantics', 'template-binding', 'style-scope'], owner: 'usr-conformance', reviewers: ['usr-architecture', 'usr-framework'], stabilityClass: 'stable', mutationPolicy: 'require-review', goldenRequired: true, blocking: true },
  { fixtureId: 'usr::integration::route-template-api-data-001', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C1', 'C2', 'C3', 'C4'], families: ['integration', 'semantic-flow', 'route-semantics', 'template-binding', 'api-boundary', 'data-boundary'], owner: 'usr-conformance', reviewers: ['usr-architecture', 'usr-security'], stabilityClass: 'stable', mutationPolicy: 'require-review', goldenRequired: true, blocking: true },
  { fixtureId: 'usr::failure-injection::parser-lock-001', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C1', 'C2'], families: ['failure-injection', 'security'], owner: 'usr-security', reviewers: ['usr-architecture', 'usr-security'], stabilityClass: 'volatile', mutationPolicy: 'require-review', goldenRequired: false, blocking: true },
  { fixtureId: 'usr::failure-injection::redaction-fail-001', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C1', 'C2', 'C3'], families: ['failure-injection', 'security', 'reporting'], owner: 'usr-security', reviewers: ['usr-architecture', 'usr-security'], stabilityClass: 'volatile', mutationPolicy: 'require-review', goldenRequired: false, blocking: true },
  { fixtureId: 'usr::failure-injection::resource-budget-001', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C1', 'C2'], families: ['failure-injection', 'runtime', 'performance'], owner: 'usr-observability', reviewers: ['usr-architecture', 'usr-operations'], stabilityClass: 'volatile', mutationPolicy: 'require-review', goldenRequired: false, blocking: true },
  { fixtureId: 'usr::failure-injection::runtime-exec-001', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C1', 'C2', 'C3'], families: ['failure-injection', 'runtime', 'security'], owner: 'usr-security', reviewers: ['usr-architecture', 'usr-security'], stabilityClass: 'volatile', mutationPolicy: 'require-review', goldenRequired: false, blocking: true },
  { fixtureId: 'usr::failure-injection::security-gate-001', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C1', 'C2'], families: ['failure-injection', 'security'], owner: 'usr-security', reviewers: ['usr-architecture', 'usr-security'], stabilityClass: 'volatile', mutationPolicy: 'require-review', goldenRequired: false, blocking: true },
  { fixtureId: 'usr::resolution::ambiguous-cap-001', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C1', 'C2'], families: ['resolution', 'ambiguity'], owner: 'usr-resolution', reviewers: ['usr-conformance'], stabilityClass: 'stable', mutationPolicy: 'allow-generated-refresh', goldenRequired: true, blocking: false },
  { fixtureId: 'vue::minimum-slice::template-style-001', profileType: 'framework', profileId: 'vue', conformanceLevels: ['C4'], families: ['minimum-slice', 'framework-overlay', 'template-binding', 'style-scope'], owner: 'framework-vue', reviewers: ['usr-architecture', 'usr-conformance'], stabilityClass: 'stable', mutationPolicy: 'require-review', goldenRequired: true, blocking: true },
  { fixtureId: 'vue::template-binding::script-setup-001', profileType: 'framework', profileId: 'vue', conformanceLevels: ['C4'], families: ['framework-overlay', 'template-binding'], owner: 'framework-vue', reviewers: ['usr-architecture', 'usr-conformance'], stabilityClass: 'stable', mutationPolicy: 'require-review', goldenRequired: true, blocking: true }
];

const fixtureGovernance = buildFixtureGovernance({
  languageBaselines,
  frameworkProfiles,
  supplementalRows: fixtureGovernanceSupplementalRows
});

const benchmarkPolicy = [
  { id: 'bench-ci-smoke', laneId: 'ci', datasetClass: 'smoke', hostClass: 'standard-ci', warmupRuns: 1, measureRuns: 5, percentileTargets: { p50DurationMs: 120000, p95DurationMs: 180000, p99DurationMs: 220000 }, maxVariancePct: 12, maxPeakMemoryMb: 2048, blocking: true },
  { id: 'bench-framework-overlay', laneId: 'lang-framework-canonicalization', datasetClass: 'framework-overlay', hostClass: 'standard-ci', warmupRuns: 1, measureRuns: 5, percentileTargets: { p50DurationMs: 300000, p95DurationMs: 450000, p99DurationMs: 540000 }, maxVariancePct: 15, maxPeakMemoryMb: 4096, blocking: true },
  { id: 'bench-lang-batch', laneId: 'ci-long', datasetClass: 'language-batch', hostClass: 'standard-ci-long', warmupRuns: 1, measureRuns: 7, percentileTargets: { p50DurationMs: 600000, p95DurationMs: 900000, p99DurationMs: 1100000 }, maxVariancePct: 18, maxPeakMemoryMb: 6144, blocking: true },
  { id: 'bench-mixed-repo', laneId: 'ci-long', datasetClass: 'mixed-repo', hostClass: 'standard-ci-long', warmupRuns: 2, measureRuns: 9, percentileTargets: { p50DurationMs: 900000, p95DurationMs: 1500000, p99DurationMs: 1800000 }, maxVariancePct: 20, maxPeakMemoryMb: 8192, blocking: false }
].sort((a, b) => a.id.localeCompare(b.id));

const threatModelMatrix = [
  { id: 'threat-path-traversal', threatClass: 'path-traversal', attackSurface: 'input', requiredControls: ['security-gate-path-traversal'], requiredFixtures: ['usr::failure-injection::security-gate-001'], severity: 'critical', blocking: true },
  { id: 'threat-parser-supply-chain', threatClass: 'parser-supply-chain', attackSurface: 'parser', requiredControls: ['security-gate-parser-lock', 'security-gate-unsafe-parser-feature'], requiredFixtures: ['usr::failure-injection::parser-lock-001'], severity: 'high', blocking: true },
  { id: 'threat-reporting-exfiltration', threatClass: 'reporting-exfiltration', attackSurface: 'reporting', requiredControls: ['security-gate-redaction-complete'], requiredFixtures: ['usr::failure-injection::redaction-fail-001'], severity: 'critical', blocking: true },
  { id: 'threat-resource-exhaustion', threatClass: 'resource-exhaustion', attackSurface: 'runtime', requiredControls: ['alert-memory-peak', 'alert-lane-duration'], requiredFixtures: ['usr::failure-injection::resource-budget-001'], severity: 'high', blocking: true },
  { id: 'threat-schema-confusion', threatClass: 'schema-confusion', attackSurface: 'serialization', requiredControls: ['security-gate-schema-no-extension'], requiredFixtures: ['usr::backcompat::bc-003'], severity: 'high', blocking: true },
  { id: 'threat-sensitive-data-leakage', threatClass: 'sensitive-data-leakage', attackSurface: 'reporting', requiredControls: ['redact-auth-token', 'redact-private-key', 'security-gate-redaction-complete'], requiredFixtures: ['usr::failure-injection::redaction-fail-001'], severity: 'critical', blocking: true },
  { id: 'threat-untrusted-execution', threatClass: 'untrusted-execution', attackSurface: 'runtime', requiredControls: ['security-gate-runtime-sandbox'], requiredFixtures: ['usr::failure-injection::runtime-exec-001'], severity: 'critical', blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const waiverPolicy = [
  { id: 'waiver-benchmark-overrun-ci-long', waiverClass: 'benchmark-overrun', scopeType: 'lane', scopeId: 'ci-long', allowedUntil: '2026-04-01T00:00:00Z', approvers: ['usr-architecture', 'usr-operations'], requiredCompensatingControls: ['usr-benchmark-regression-summary.json'], maxExtensions: 1, blocking: true },
  { id: 'waiver-non-strict-backcompat-warning', waiverClass: 'non-strict-compat-warning', scopeType: 'artifact', scopeId: 'usr-backcompat-matrix-results', allowedUntil: '2026-04-01T00:00:00Z', approvers: ['usr-rollout', 'usr-architecture'], requiredCompensatingControls: ['usr-waiver-active-report.json'], maxExtensions: 2, blocking: true },
  { id: 'waiver-observability-gap-temp', waiverClass: 'observability-gap', scopeType: 'phase', scopeId: 'phase-10', allowedUntil: '2026-03-15T00:00:00Z', approvers: ['usr-observability', 'usr-operations'], requiredCompensatingControls: ['usr-observability-rollup.json'], maxExtensions: 1, blocking: false },
  { id: 'waiver-temporary-parser-regression', waiverClass: 'temporary-parser-regression', scopeType: 'language', scopeId: 'perl', allowedUntil: '2026-03-20T00:00:00Z', approvers: ['language-perl', 'usr-architecture'], requiredCompensatingControls: ['usr-feature-flag-state.json', 'usr-waiver-expiry-report.json'], maxExtensions: 1, blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const qualityGates = [
  { id: 'qg-framework-binding-f1', domain: 'framework-binding', scopeType: 'global', scopeId: 'global', metric: 'f1', thresholdOperator: '>=', thresholdValue: 0.92, fixtureSetId: 'framework-binding-goldens', blocking: true },
  { id: 'qg-provenance-recall', domain: 'provenance', scopeType: 'global', scopeId: 'global', metric: 'recall', thresholdOperator: '>=', thresholdValue: 0.9, fixtureSetId: 'provenance-goldens', blocking: true },
  { id: 'qg-resolution-precision-ts', domain: 'resolution', scopeType: 'language', scopeId: 'typescript', metric: 'precision', thresholdOperator: '>=', thresholdValue: 0.95, fixtureSetId: 'resolution-typescript-goldens', blocking: true },
  { id: 'qg-risk-false-positive-js', domain: 'risk', scopeType: 'language', scopeId: 'javascript', metric: 'false-positive-rate', thresholdOperator: '<=', thresholdValue: 0.08, fixtureSetId: 'risk-javascript-goldens', blocking: false },
  { id: 'qg-risk-recall-py', domain: 'risk', scopeType: 'language', scopeId: 'python', metric: 'recall', thresholdOperator: '>=', thresholdValue: 0.9, fixtureSetId: 'risk-python-goldens', blocking: true },
  { id: 'qg-vue-template-binding-precision', domain: 'framework-binding', scopeType: 'framework', scopeId: 'vue', metric: 'precision', thresholdOperator: '>=', thresholdValue: 0.93, fixtureSetId: 'framework-vue-template-goldens', blocking: true },
  { id: 'qg-min-slice-typescript-vue', domain: 'minimum-slice', scopeType: 'framework', scopeId: 'vue', metric: 'pass-rate', thresholdOperator: '>=', thresholdValue: 1.0, fixtureSetId: 'minimum-slice-typescript-vue', blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const operationalReadinessPolicy = [
  { id: 'ops-cutover-window', phase: 'cutover', runbookId: 'usr-cutover-runbook', severityClass: 'n/a', requiredRoles: ['usr-architecture', 'usr-operations', 'usr-release-manager'], requiredArtifacts: ['usr-release-readiness-scorecard.json', 'usr-waiver-active-report.json'], communicationChannels: ['release-bridge', 'status-page'], maxResponseMinutes: 15, maxRecoveryMinutes: 60, blocking: true },
  { id: 'ops-incident-critical', phase: 'incident', runbookId: 'usr-incident-critical-runbook', severityClass: 'sev1', requiredRoles: ['usr-oncall-platform', 'usr-oncall-security'], requiredArtifacts: ['usr-incident-response-drill-report.json'], communicationChannels: ['incident-bridge', 'security-hotline'], maxResponseMinutes: 10, maxRecoveryMinutes: 120, blocking: true },
  { id: 'ops-post-cutover-review', phase: 'post-cutover', runbookId: 'usr-post-cutover-review-runbook', severityClass: 'n/a', requiredRoles: ['usr-operations', 'usr-conformance'], requiredArtifacts: ['usr-observability-rollup.json', 'usr-quality-regression-report.json'], communicationChannels: ['release-review'], maxResponseMinutes: 60, maxRecoveryMinutes: 240, blocking: false },
  { id: 'ops-pre-cutover-checklist', phase: 'pre-cutover', runbookId: 'usr-pre-cutover-checklist', severityClass: 'n/a', requiredRoles: ['usr-architecture', 'usr-rollout'], requiredArtifacts: ['usr-operational-readiness-validation.json', 'usr-rollback-drill-report.json'], communicationChannels: ['release-planning'], maxResponseMinutes: 30, maxRecoveryMinutes: 180, blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const ownershipMatrix = [
  { id: 'own-core-artifacts', domain: 'artifact-schema-catalog', ownerRole: 'usr-architecture', backupOwnerRole: 'usr-conformance', escalationPolicyId: 'esc-contract-conflict', evidenceArtifacts: ['usr-validation-report.json'], blocking: true },
  { id: 'own-diagnostics-taxonomy', domain: 'diagnostics-reasoncodes', ownerRole: 'usr-conformance', backupOwnerRole: 'usr-architecture', escalationPolicyId: 'esc-taxonomy-drift', evidenceArtifacts: ['usr-validation-report.json', 'usr-conformance-summary.json'], blocking: true },
  { id: 'own-framework-profiles', domain: 'language-framework-catalog', ownerRole: 'usr-framework', backupOwnerRole: 'usr-architecture', escalationPolicyId: 'esc-framework-contract-conflict', evidenceArtifacts: ['usr-conformance-summary.json', 'usr-quality-evaluation-results.json'], blocking: true },
  { id: 'own-security-governance', domain: 'security-risk-compliance', ownerRole: 'usr-security', backupOwnerRole: 'usr-operations', escalationPolicyId: 'esc-security-gate-failure', evidenceArtifacts: ['usr-threat-model-coverage-report.json', 'usr-failure-injection-report.json'], blocking: true },
  { id: 'own-observability-slo', domain: 'observability-performance-ops', ownerRole: 'usr-observability', backupOwnerRole: 'usr-operations', escalationPolicyId: 'esc-slo-budget-breach', evidenceArtifacts: ['usr-observability-rollup.json', 'usr-benchmark-summary.json'], blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const escalationPolicy = [
  { id: 'esc-contract-conflict', triggerClass: 'contract-conflict', severity: 'high', requiredApprovers: ['usr-architecture', 'usr-release-manager'], maxAckMinutes: 60, maxResolutionMinutes: 240, autoBlockPromotion: true },
  { id: 'esc-framework-contract-conflict', triggerClass: 'framework-conflict', severity: 'high', requiredApprovers: ['usr-framework', 'usr-architecture'], maxAckMinutes: 45, maxResolutionMinutes: 180, autoBlockPromotion: true },
  { id: 'esc-security-gate-failure', triggerClass: 'security-gate-failure', severity: 'critical', requiredApprovers: ['usr-security', 'usr-oncall-platform'], maxAckMinutes: 15, maxResolutionMinutes: 120, autoBlockPromotion: true },
  { id: 'esc-slo-budget-breach', triggerClass: 'slo-budget-breach', severity: 'high', requiredApprovers: ['usr-observability', 'usr-operations'], maxAckMinutes: 30, maxResolutionMinutes: 180, autoBlockPromotion: true },
  { id: 'esc-taxonomy-drift', triggerClass: 'taxonomy-drift', severity: 'medium', requiredApprovers: ['usr-conformance', 'usr-architecture'], maxAckMinutes: 120, maxResolutionMinutes: 720, autoBlockPromotion: false }
].sort((a, b) => a.id.localeCompare(b.id));

/**
 * Resolve embedding policy for one language, with language-level overrides.
 *
 * @param {string} languageId
 * @param {string} family
 * @returns {{canHostEmbedded:boolean,canBeEmbedded:boolean,embeddedLanguageAllowlist:string[]}}
 */
function embeddingPolicyFor(languageId, family) {
  if (customEmbeddingPolicies[languageId]) {
    return customEmbeddingPolicies[languageId];
  }
  if (family === 'markup') {
    return { canHostEmbedded: true, canBeEmbedded: true, embeddedLanguageAllowlist: ['css', 'javascript'] };
  }
  if (family === 'style' || family === 'data-interface' || family === 'config-data') {
    return { canHostEmbedded: false, canBeEmbedded: true, embeddedLanguageAllowlist: [] };
  }
  return { canHostEmbedded: false, canBeEmbedded: false, embeddedLanguageAllowlist: [] };
}

const HIGH_SIGNAL_RISK_FAMILIES = new Set(['dynamic', 'js-ts', 'managed', 'systems']);
const BLOCKING_CAPABILITIES = new Set(['ast', 'docmeta', 'symbolGraph']);
const CAPABILITY_NO_DIAGNOSTICS = [];
const CAPABILITY_DOWNGRADED_DIAGNOSTICS = ['USR-W-CAPABILITY-DOWNGRADED'];
const CAPABILITY_LOST_DIAGNOSTICS = ['USR-E-CAPABILITY-LOST'];
const SORTED_CAPABILITIES = [...CAPABILITIES].sort();
const RISK_REQUIRED_SANITIZERS = ['allowlist', 'context-escape', 'parameterization'];
const RISK_OPTIONAL_SOURCES = ['config-input'];
const RISK_OPTIONAL_SINKS = ['logging-sink'];
const RISK_OPTIONAL_SANITIZERS = ['encoding-normalization'];
const RISK_UNSUPPORTED_SANITIZERS = [];
const RISK_MIN_EVIDENCE_KINDS = ['calls', 'references'];
const RISK_SEVERITY_LEVELS = ['info', 'low', 'medium', 'high', 'critical'];
const RISK_SOURCES_HIGH_SIGNAL = ['environment-input', 'external-input'];
const RISK_SOURCES_LOW_SIGNAL = ['template-input'];
const RISK_SINKS_HIGH_SIGNAL = ['command-exec', 'filesystem-write', 'network-egress'];
const RISK_SINKS_LOW_SIGNAL = ['template-render'];
const RISK_INTERPROCEDURAL_UNSUPPORTED_SOURCES = ['interprocedural-source'];
const RISK_INTERPROCEDURAL_UNSUPPORTED_SINKS = ['interprocedural-sink'];

export {
  SCHEMA_VERSION,
  CAPABILITIES,
  languageBaselines,
  familyNodeKinds,
  familyEdgeKinds,
  familyCapabilities,
  parserFallbackByPreference,
  customEmbeddingPolicies,
  frameworkProfiles,
  frameworkEdgeCases,
  edgeKindConstraints,
  nodeKindMappings,
  backcompatMatrix,
  embeddingBridgeCases,
  generatedProvenanceCases,
  parserRuntimeLocks,
  sloBudgets,
  alertPolicies,
  redactionRules,
  securityGates,
  runtimeConfigPolicy,
  failureInjectionMatrix,
  fixtureGovernance,
  benchmarkPolicy,
  threatModelMatrix,
  waiverPolicy,
  qualityGates,
  operationalReadinessPolicy,
  ownershipMatrix,
  escalationPolicy,
  embeddingPolicyFor,
  HIGH_SIGNAL_RISK_FAMILIES,
  BLOCKING_CAPABILITIES,
  CAPABILITY_NO_DIAGNOSTICS,
  CAPABILITY_DOWNGRADED_DIAGNOSTICS,
  CAPABILITY_LOST_DIAGNOSTICS,
  SORTED_CAPABILITIES,
  RISK_REQUIRED_SANITIZERS,
  RISK_OPTIONAL_SOURCES,
  RISK_OPTIONAL_SINKS,
  RISK_OPTIONAL_SANITIZERS,
  RISK_UNSUPPORTED_SANITIZERS,
  RISK_MIN_EVIDENCE_KINDS,
  RISK_SEVERITY_LEVELS,
  RISK_SOURCES_HIGH_SIGNAL,
  RISK_SOURCES_LOW_SIGNAL,
  RISK_SINKS_HIGH_SIGNAL,
  RISK_SINKS_LOW_SIGNAL,
  RISK_INTERPROCEDURAL_UNSUPPORTED_SOURCES,
  RISK_INTERPROCEDURAL_UNSUPPORTED_SINKS
};
