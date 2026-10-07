import { normalizeProviderId } from './provider-contract.js';

const DELTAS = Object.freeze({
  clangd: Object.freeze({
    id: 'clangd',
    class: 'dedicated',
    language: 'c/cpp',
    defaultEnabled: true,
    requestBudgetWeight: 1,
    confidenceBias: 0.03,
    adaptiveDocScope: Object.freeze({
      docThreshold: 64,
      maxDocs: 64,
      degradedMaxDocs: 32,
      targetThreshold: 256,
      maxTargets: 256,
      degradedMaxTargets: 96,
      degradedDocumentSymbolTimeouts: 1,
      degradedDocumentSymbolP95Ms: 3500,
      defaultHoverMaxPerFile: 4,
      degradedHoverMaxPerFile: 2
    }),
    workspaceChecks: Object.freeze(['clangd_compile_commands_missing']),
    bootstrapChecks: Object.freeze([]),
    fallbackReasonHints: Object.freeze(['lsp_definition_timeout', 'lsp_hover_incomplete'])
  }),
  pyright: Object.freeze({
    id: 'pyright',
    class: 'dedicated',
    language: 'python',
    defaultEnabled: true,
    requestBudgetWeight: 1.2,
    confidenceBias: 0.04,
    adaptiveDocScope: Object.freeze({
      docThreshold: 192,
      maxDocs: 192,
      degradedMaxDocs: 96,
      targetThreshold: 512,
      maxTargets: 512,
      degradedMaxTargets: 192,
      degradedDocumentSymbolTimeouts: 2,
      degradedDocumentSymbolP95Ms: 2500,
      defaultHoverMaxPerFile: 6,
      degradedHoverMaxPerFile: 3
    }),
    workspaceChecks: Object.freeze(['pyright_workspace_scan_outlier', 'pyright_workspace_config_invalid']),
    bootstrapChecks: Object.freeze([]),
    fallbackReasonHints: Object.freeze(['lsp_signature_help_incomplete', 'lsp_hover_incomplete'])
  }),
  sourcekit: Object.freeze({
    id: 'sourcekit',
    class: 'dedicated',
    language: 'swift',
    defaultEnabled: true,
    requestBudgetWeight: 0.9,
    confidenceBias: 0.02,
    adaptiveDocScope: Object.freeze({
      docThreshold: 64,
      maxDocs: 64,
      degradedMaxDocs: 32,
      targetThreshold: 160,
      maxTargets: 128,
      degradedMaxTargets: 64,
      degradedHoverTimeouts: 2,
      degradedHoverP95Ms: 2000,
      defaultHoverMaxPerFile: 3,
      degradedHoverMaxPerFile: 1
    }),
    workspaceChecks: Object.freeze(['sourcekit_package_preflight_failed']),
    bootstrapChecks: Object.freeze(['sourcekit_host_lock_unavailable']),
    fallbackReasonHints: Object.freeze(['lsp_signature_help_missing', 'lsp_hover_incomplete'])
  }),
  gopls: Object.freeze({
    id: 'gopls',
    class: 'preset',
    language: 'go',
    defaultEnabled: true,
    requestBudgetWeight: 1.15,
    confidenceBias: 0.03,
    adaptiveDocScope: Object.freeze({
      docThreshold: 192,
      maxDocs: 320,
      degradedMaxDocs: 160,
      targetThreshold: 384,
      maxTargets: 768,
      degradedMaxTargets: 256,
      degradedDocumentSymbolTimeouts: 2,
      degradedDocumentSymbolP95Ms: 2500,
      defaultHoverMaxPerFile: 10,
      degradedHoverMaxPerFile: 6
    }),
    workspaceChecks: Object.freeze(['go_workspace_module_preflight_failed', 'gopls_workspace_model_missing']),
    bootstrapChecks: Object.freeze([]),
    fallbackReasonHints: Object.freeze(['lsp_signature_help_incomplete', 'lsp_definition_missing'])
  }),
  'rust-analyzer': Object.freeze({
    id: 'rust-analyzer',
    class: 'preset',
    language: 'rust',
    defaultEnabled: true,
    requestBudgetWeight: 1.05,
    confidenceBias: 0.03,
    adaptiveDocScope: Object.freeze({
      docThreshold: 256,
      maxDocs: 320,
      degradedMaxDocs: 192,
      targetThreshold: 384,
      maxTargets: 768,
      degradedMaxTargets: 320,
      degradedDocumentSymbolTimeouts: 2,
      degradedDocumentSymbolP95Ms: 3000,
      defaultHoverMaxPerFile: 8,
      degradedHoverMaxPerFile: 4
    }),
    workspaceChecks: Object.freeze(['rust_workspace_metadata_preflight_failed', 'rust_workspace_proc_macro_suppression_active']),
    bootstrapChecks: Object.freeze([]),
    fallbackReasonHints: Object.freeze(['lsp_references_incomplete', 'lsp_hover_incomplete'])
  }),
  'yaml-language-server': Object.freeze({
    id: 'yaml-language-server',
    class: 'preset',
    language: 'yaml',
    defaultEnabled: true,
    requestBudgetWeight: 0.85,
    confidenceBias: -0.03,
    adaptiveDocScope: Object.freeze({
      docThreshold: 64,
      maxDocs: 96,
      degradedMaxDocs: 48,
      targetThreshold: 96,
      maxTargets: 160,
      degradedMaxTargets: 80
    }),
    workspaceChecks: Object.freeze(['yaml_schema_store_remote_enabled']),
    bootstrapChecks: Object.freeze([]),
    fallbackReasonHints: Object.freeze(['lsp_hover_disabled_by_capability'])
  }),
  'lua-language-server': Object.freeze({
    id: 'lua-language-server',
    class: 'preset',
    language: 'lua',
    defaultEnabled: true,
    requestBudgetWeight: 0.95,
    confidenceBias: 0.01,
    adaptiveDocScope: Object.freeze({
      docThreshold: 192,
      maxDocs: 256,
      degradedMaxDocs: 160,
      targetThreshold: 320,
      maxTargets: 640,
      degradedMaxTargets: 256,
      degradedDocumentSymbolTimeouts: 2,
      degradedDocumentSymbolP95Ms: 2500,
      defaultHoverMaxPerFile: 8,
      degradedHoverMaxPerFile: 5
    }),
    workspaceChecks: Object.freeze(['lua_workspace_library_missing', 'lua_workspace_config_invalid']),
    bootstrapChecks: Object.freeze([]),
    fallbackReasonHints: Object.freeze(['lsp_hover_incomplete'])
  }),
  zls: Object.freeze({
    id: 'zls',
    class: 'preset',
    language: 'zig',
    defaultEnabled: true,
    requestBudgetWeight: 1,
    confidenceBias: 0.02,
    adaptiveDocScope: Object.freeze({
      docThreshold: 160,
      maxDocs: 256,
      degradedMaxDocs: 128,
      targetThreshold: 256,
      maxTargets: 512,
      degradedMaxTargets: 192,
      degradedDocumentSymbolTimeouts: 2,
      degradedDocumentSymbolP95Ms: 2500,
      defaultHoverMaxPerFile: 6,
      degradedHoverMaxPerFile: 4
    }),
    workspaceChecks: Object.freeze(['zls_workspace_nested_root', 'zls_workspace_ambiguous_root']),
    bootstrapChecks: Object.freeze([]),
    fallbackReasonHints: Object.freeze(['lsp_signature_help_missing'])
  }),
  jdtls: Object.freeze({
    id: 'jdtls',
    class: 'dedicated',
    language: 'java',
    defaultEnabled: true,
    requestBudgetWeight: 1.05,
    confidenceBias: 0.02,
    adaptiveDocScope: Object.freeze({
      docThreshold: 128,
      maxDocs: 192,
      degradedMaxDocs: 96,
      targetThreshold: 256,
      maxTargets: 384,
      degradedMaxTargets: 160,
      degradedDocumentSymbolTimeouts: 2,
      degradedDocumentSymbolP95Ms: 2500,
      defaultHoverMaxPerFile: 5,
      degradedHoverMaxPerFile: 3
    }),
    workspaceChecks: Object.freeze(['jdtls_workspace_lock_unavailable']),
    bootstrapChecks: Object.freeze(['jdtls_workspace_bootstrap']),
    fallbackReasonHints: Object.freeze(['lsp_definition_missing', 'lsp_hover_incomplete'])
  }),
  'csharp-ls': Object.freeze({
    id: 'csharp-ls',
    class: 'dedicated',
    language: 'csharp',
    defaultEnabled: true,
    requestBudgetWeight: 1,
    confidenceBias: 0.02,
    adaptiveDocScope: Object.freeze({
      docThreshold: 160,
      maxDocs: 192,
      degradedMaxDocs: 96,
      targetThreshold: 256,
      maxTargets: 384,
      degradedMaxTargets: 160,
      degradedDocumentSymbolTimeouts: 2,
      degradedDocumentSymbolP95Ms: 2500,
      defaultHoverMaxPerFile: 5,
      degradedHoverMaxPerFile: 3
    }),
    workspaceChecks: Object.freeze(['csharp_workspace_ambiguous_solution', 'csharp_workspace_ambiguous_project']),
    bootstrapChecks: Object.freeze(['csharp_launch_bootstrap_missing']),
    fallbackReasonHints: Object.freeze(['lsp_signature_help_incomplete'])
  }),
  'elixir-ls': Object.freeze({
    id: 'elixir-ls',
    class: 'dedicated',
    language: 'elixir',
    defaultEnabled: true,
    requestBudgetWeight: 0.95,
    confidenceBias: 0.01,
    adaptiveDocScope: Object.freeze({
      docThreshold: 160,
      maxDocs: 224,
      degradedMaxDocs: 128,
      targetThreshold: 224,
      maxTargets: 384,
      degradedMaxTargets: 160,
      degradedDocumentSymbolTimeouts: 2,
      degradedDocumentSymbolP95Ms: 2600,
      defaultHoverMaxPerFile: 5,
      degradedHoverMaxPerFile: 3
    }),
    workspaceChecks: Object.freeze(['elixir_workspace_runtime_otp_mismatch', 'elixir_workspace_mix_lock_missing']),
    bootstrapChecks: Object.freeze([]),
    fallbackReasonHints: Object.freeze(['lsp_hover_incomplete'])
  }),
  'haskell-language-server': Object.freeze({
    id: 'haskell-language-server',
    class: 'dedicated',
    language: 'haskell',
    defaultEnabled: true,
    requestBudgetWeight: 0.95,
    confidenceBias: 0.02,
    adaptiveDocScope: Object.freeze({
      docThreshold: 128,
      maxDocs: 192,
      degradedMaxDocs: 96,
      targetThreshold: 192,
      maxTargets: 320,
      degradedMaxTargets: 128,
      degradedDocumentSymbolTimeouts: 2,
      degradedDocumentSymbolP95Ms: 2600,
      defaultHoverMaxPerFile: 4,
      degradedHoverMaxPerFile: 2
    }),
    workspaceChecks: Object.freeze(['haskell_workspace_ambiguous_cradle']),
    bootstrapChecks: Object.freeze([]),
    fallbackReasonHints: Object.freeze(['lsp_signature_help_missing'])
  }),
  phpactor: Object.freeze({
    id: 'phpactor',
    class: 'dedicated',
    language: 'php',
    defaultEnabled: true,
    requestBudgetWeight: 0.95,
    confidenceBias: 0.01,
    adaptiveDocScope: Object.freeze({
      docThreshold: 128,
      maxDocs: 192,
      degradedMaxDocs: 96,
      targetThreshold: 192,
      maxTargets: 320,
      degradedMaxTargets: 128,
      degradedDocumentSymbolTimeouts: 2,
      degradedDocumentSymbolP95Ms: 2400,
      defaultHoverMaxPerFile: 4,
      degradedHoverMaxPerFile: 2
    }),
    workspaceChecks: Object.freeze(['phpactor_workspace_composer_invalid', 'phpactor_workspace_composer_lock_missing']),
    bootstrapChecks: Object.freeze([]),
    fallbackReasonHints: Object.freeze(['lsp_definition_missing'])
  }),
  solargraph: Object.freeze({
    id: 'solargraph',
    class: 'dedicated',
    language: 'ruby',
    defaultEnabled: true,
    requestBudgetWeight: 0.95,
    confidenceBias: 0.02,
    adaptiveDocScope: Object.freeze({
      docThreshold: 128,
      maxDocs: 192,
      degradedMaxDocs: 96,
      targetThreshold: 192,
      maxTargets: 320,
      degradedMaxTargets: 128,
      degradedDocumentSymbolTimeouts: 2,
      degradedDocumentSymbolP95Ms: 2400,
      defaultHoverMaxPerFile: 4,
      degradedHoverMaxPerFile: 2
    }),
    workspaceChecks: Object.freeze(['solargraph_workspace_runtime_toolchain_missing_bundle', 'solargraph_workspace_gemfile_lock_missing']),
    bootstrapChecks: Object.freeze([]),
    fallbackReasonHints: Object.freeze(['lsp_hover_incomplete'])
  }),
  dart: Object.freeze({
    id: 'dart',
    class: 'dedicated',
    language: 'dart',
    defaultEnabled: true,
    requestBudgetWeight: 1,
    confidenceBias: 0.02,
    adaptiveDocScope: Object.freeze({
      docThreshold: 160,
      maxDocs: 224,
      degradedMaxDocs: 128,
      targetThreshold: 224,
      maxTargets: 384,
      degradedMaxTargets: 160,
      degradedDocumentSymbolTimeouts: 2,
      degradedDocumentSymbolP95Ms: 2400,
      defaultHoverMaxPerFile: 5,
      degradedHoverMaxPerFile: 3
    }),
    workspaceChecks: Object.freeze(['dart_workspace_package_config_missing']),
    bootstrapChecks: Object.freeze([]),
    fallbackReasonHints: Object.freeze(['lsp_signature_help_missing', 'lsp_hover_incomplete'])
  })
});

const cloneDelta = (delta) => ({
  ...delta,
  adaptiveDocScope: delta?.adaptiveDocScope && typeof delta.adaptiveDocScope === 'object'
    ? { ...delta.adaptiveDocScope }
    : null,
  workspaceChecks: Array.isArray(delta?.workspaceChecks) ? delta.workspaceChecks.slice() : [],
  bootstrapChecks: Array.isArray(delta?.bootstrapChecks) ? delta.bootstrapChecks.slice() : [],
  fallbackReasonHints: Array.isArray(delta?.fallbackReasonHints) ? delta.fallbackReasonHints.slice() : []
});

export const listLspProviderDeltas = () => Object.values(DELTAS).map((delta) => cloneDelta(delta));

export const getLspProviderDelta = (value) => {
  const normalizedId = normalizeProviderId(value);
  if (!normalizedId) return null;
  const delta = DELTAS[normalizedId];
  return delta ? cloneDelta(delta) : null;
};

export const listDefaultEnabledLspProviderIds = () => (
  listLspProviderDeltas()
    .filter((delta) => delta.defaultEnabled === true)
    .map((delta) => delta.id)
    .sort((left, right) => left.localeCompare(right))
);
