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

export {
  frameworkProfiles,
  frameworkEdgeCases,
  edgeKindConstraints,
  nodeKindMappings
};
