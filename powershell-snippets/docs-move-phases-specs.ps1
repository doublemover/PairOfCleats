# Docs reorg snippet (phases, specs, guides, config, references)
# Creates destination folders and moves legacy files into the new layout.

$dirs = @(
  'docs\api',
  'docs\benchmarks',
  'docs\config',
  'docs\contracts',
  'docs\dependency_references',
  'docs\guides',
  'docs\language',
  'docs\phases\phase-0',
  'docs\phases\phase-3',
  'docs\phases\phase-4',
  'docs\phases\phase-8',
  'docs\phases\phase-9',
  'docs\phases\phase-10',
  'docs\phases\phase-12',
  'docs\phases\phase-14',
  'docs\specs',
  'docs\sqlite',
  'docs\tooling',
  'docs\testing'
)
$dirs | ForEach-Object { New-Item -ItemType Directory -Force $_ | Out-Null }

$moveMap = @(
  @{ from = 'docs\phase-0-tracking.md'; to = 'docs\phases\phase-0\tracking.md' },
  @{ from = 'docs\phase-0-fixture-corpus.md'; to = 'docs\phases\phase-0\fixture-corpus.md' },
  @{ from = 'docs\phase-3-analysis-policy-spec.md'; to = 'docs\phases\phase-3\analysis-policy.md' },
  @{ from = 'docs\phase-3-build-state-integrity-spec.md'; to = 'docs\phases\phase-3\build-state-integrity.md' },
  @{ from = 'docs\phase-3-import-resolution-spec.md'; to = 'docs\phases\phase-3\import-resolution.md' },
  @{ from = 'docs\phase-3-segmentation-perf-spec.md'; to = 'docs\phases\phase-3\segmentation-perf.md' },
  @{ from = 'docs\phase-3-signature-spec.md'; to = 'docs\phases\phase-3\signature.md' },
  @{ from = 'docs\phase-3-tooling-io-spec.md'; to = 'docs\phases\phase-3\tooling-io.md' },
  @{ from = 'docs\phase-3-watch-atomicity-spec.md'; to = 'docs\phases\phase-3\watch-atomicity.md' },
  @{ from = 'docs\spec_phase4_concurrency_abort_runwithqueue.md'; to = 'docs\phases\phase-4\concurrency-abort-runwithqueue.md' },
  @{ from = 'docs\spec_phase4_json_stream_atomic_replace.md'; to = 'docs\phases\phase-4\json-stream-atomic-replace.md' },
  @{ from = 'docs\spec_phase4_large_file_caps_strategy.md'; to = 'docs\phases\phase-4\large-file-caps-strategy.md' },
  @{ from = 'docs\spec_phase4_runtime_envelope_v1.md'; to = 'docs\phases\phase-4\runtime-envelope.md' },
  @{ from = 'docs\spec_phase4_safe_regex_hardening.md'; to = 'docs\phases\phase-4\safe-regex-hardening.md' },
  @{ from = 'docs\spec_phase4_subprocess_helper.md'; to = 'docs\phases\phase-4\subprocess-helper.md' },
  @{ from = 'docs\spec_phase8_identity_and_symbol_contracts_refined.md'; to = 'docs\phases\phase-8\identity-and-symbol-contracts.md' },
  @{ from = 'docs\spec_phase8_lsp_provider_hardening_refined.md'; to = 'docs\phases\phase-8\lsp-provider-hardening.md' },
  @{ from = 'docs\spec_phase8_tooling_doctor_and_reporting_refined.md'; to = 'docs\phases\phase-8\tooling-doctor-and-reporting.md' },
  @{ from = 'docs\spec_phase8_tooling_provider_registry_refined.md'; to = 'docs\phases\phase-8\tooling-provider-registry.md' },
  @{ from = 'docs\spec_phase8_tooling_vfs_and_segment_routing_refined.md'; to = 'docs\phases\phase-8\tooling-vfs-and-segment-routing.md' },
  @{ from = 'docs\spec_phase8_typescript_provider_js_parity_refined.md'; to = 'docs\phases\phase-8\typescript-provider-js-parity.md' },
  @{ from = 'docs\PHASE9_SPEC_IDENTITY_CONTRACTS.md'; to = 'docs\phases\phase-9\identity-contracts.md' },
  @{ from = 'docs\PHASE9_SPEC_MIGRATION_AND_BACKCOMPAT.md'; to = 'docs\phases\phase-9\migration-and-backcompat.md' },
  @{ from = 'docs\PHASE9_SPEC_SYMBOL_ARTIFACTS_AND_PIPELINE.md'; to = 'docs\phases\phase-9\symbol-artifacts-and-pipeline.md' },
  @{ from = 'docs\PH10_refined_implementation_plan.md'; to = 'docs\phases\phase-10\implementation-plan.md' },
  @{ from = 'docs\PHASE12_TEST_STRATEGY_AND_CONFORMANCE_MATRIX_REFINED_DETERMINISTIC_FIXTURES.md'; to = 'docs\phases\phase-12\test-strategy-and-conformance-matrix.md' },
  @{ from = 'docs\PHASE12_TOOLING_AND_API_CONTRACT_SPEC_REFINED.md'; to = 'docs\phases\phase-12\tooling-and-api-contract.md' },
  @{ from = 'docs\SPEC_PHASE14_AS_OF_RETRIEVAL_INTEGRATION_REFINED.md'; to = 'docs\phases\phase-14\as-of-retrieval-integration.md' },
  @{ from = 'docs\SPEC_PHASE14_IMPLEMENTATION_CHECKLIST.md'; to = 'docs\phases\phase-14\implementation-checklist.md' },
  @{ from = 'docs\SPEC_PHASE14_INDEX_DIFFS_REFINED.md'; to = 'docs\phases\phase-14\index-diffs.md' },
  @{ from = 'docs\SPEC_PHASE14_INDEX_REFS_AND_SNAPSHOTS_REFINED.md'; to = 'docs\phases\phase-14\index-refs-and-snapshots.md' },
  @{ from = 'docs\spec-context-packs.md'; to = 'docs\specs\context-packs.md' },
  @{ from = 'docs\spec-graph-explainability.md'; to = 'docs\specs\graph-explainability.md' },
  @{ from = 'docs\spec-graph-ranking.md'; to = 'docs\specs\graph-ranking.md' },
  @{ from = 'docs\spec-impact-analysis.md'; to = 'docs\specs\impact-analysis.md' },
  @{ from = 'docs\spec-identity-contract.refined.md'; to = 'docs\specs\identity-contract.md' },
  @{ from = 'docs\spec-symbol-artifacts.refined.md'; to = 'docs\specs\symbol-artifacts.md' },
  @{ from = 'docs\spec-symbol-identity-and-symbolref.refined.md'; to = 'docs\specs\symbol-identity-and-symbolref.md' },
  @{ from = 'docs\spec-vfs-manifest-artifact.md'; to = 'docs\specs\vfs-manifest-artifact.md' },
  @{ from = 'docs\spec_federated_search_refined.md'; to = 'docs\specs\federated-search.md' },
  @{ from = 'docs\spec_workspace_manifest_refined.md'; to = 'docs\specs\workspace-manifest.md' },
  @{ from = 'docs\spec_workspace_config_refined.md'; to = 'docs\specs\workspace-config.md' },
  @{ from = 'docs\SPEC_JJ_PROVIDER_COMMANDS_AND_PARSING.md'; to = 'docs\specs\jj-provider-commands-and-parsing.md' },
  @{ from = 'docs\SPEC_SCM_PROVIDER_CONFIG_AND_STATE_SCHEMA.md'; to = 'docs\specs\scm-provider-config-and-state-schema.md' },
  @{ from = 'docs\SPEC_risk_callsite_id_and_stats_v1_refined.md'; to = 'docs\specs\risk-callsite-id-and-stats.md' },
  @{ from = 'docs\SPEC_risk_flows_and_call_sites_jsonl_v1_refined.md'; to = 'docs\specs\risk-flows-and-call-sites.md' },
  @{ from = 'docs\SPEC_risk_interprocedural_config_v1_refined.md'; to = 'docs\specs\risk-interprocedural-config.md' },
  @{ from = 'docs\SPEC_risk_interprocedural_stats_json_v1_refined.md'; to = 'docs\specs\risk-interprocedural-stats.md' },
  @{ from = 'docs\SPEC_risk_summaries_jsonl_v1_refined.md'; to = 'docs\specs\risk-summaries.md' },
  @{ from = 'docs\metadata-schema-v2.md'; to = 'docs\specs\metadata-schema-v2.md' },
  @{ from = 'docs\map-schema.json'; to = 'docs\specs\map-schema.json' },
  @{ from = 'docs\artifact-contract.md'; to = 'docs\contracts\artifact-contract.md' },
  @{ from = 'docs\analysis-schemas.md'; to = 'docs\contracts\analysis-schemas.md' },
  @{ from = 'docs\artifact-schemas.md'; to = 'docs\contracts\artifact-schemas.md' },
  @{ from = 'docs\compatibility-key.md'; to = 'docs\contracts\compatibility-key.md' },
  @{ from = 'docs\search-contract.md'; to = 'docs\contracts\search-contract.md' },
  @{ from = 'docs\contracts\api-mcp.md'; to = 'docs\contracts\mcp-api.md' },
  @{ from = 'docs\api-server.md'; to = 'docs\api\server.md' },
  @{ from = 'docs\core-api.md'; to = 'docs\api\core-api.md' },
  @{ from = 'docs\mcp-server.md'; to = 'docs\api\mcp-server.md' },
  @{ from = 'docs\config-schema.json'; to = 'docs\config\schema.json' },
  @{ from = 'docs\config-inventory.json'; to = 'docs\config\inventory.json' },
  @{ from = 'docs\config-inventory.md'; to = 'docs\config\inventory.md' },
  @{ from = 'docs\config-inventory-notes.md'; to = 'docs\config\inventory-notes.md' },
  @{ from = 'docs\config-budgets.md'; to = 'docs\config\budgets.md' },
  @{ from = 'docs\config-contract.md'; to = 'docs\config\contract.md' },
  @{ from = 'docs\config-deprecations.md'; to = 'docs\config\deprecations.md' },
  @{ from = 'docs\config_execution_plan.md'; to = 'docs\config\execution-plan.md' },
  @{ from = 'docs\config_hard_cut.md'; to = 'docs\config\hard-cut.md' },
  @{ from = 'docs\config_surface_directives.md'; to = 'docs\config\surface-directives.md' },
  @{ from = 'docs\env-overrides.md'; to = 'docs\config\env-overrides.md' },
  @{ from = 'docs\commands.md'; to = 'docs\guides\commands.md' },
  @{ from = 'docs\setup.md'; to = 'docs\guides\setup.md' },
  @{ from = 'docs\search.md'; to = 'docs\guides\search.md' },
  @{ from = 'docs\service-mode.md'; to = 'docs\guides\service-mode.md' },
  @{ from = 'docs\editor-integration.md'; to = 'docs\guides\editor-integration.md' },
  @{ from = 'docs\external-backends.md'; to = 'docs\guides\external-backends.md' },
  @{ from = 'docs\release-discipline.md'; to = 'docs\guides\release-discipline.md' },
  @{ from = 'docs\repometrics-dashboard.md'; to = 'docs\guides\repometrics-dashboard.md' },
  @{ from = 'docs\rule-packs.md'; to = 'docs\guides\rule-packs.md' },
  @{ from = 'docs\risk-rules.md'; to = 'docs\guides\risk-rules.md' },
  @{ from = 'docs\triage-records.md'; to = 'docs\guides\triage-records.md' },
  @{ from = 'docs\code-maps.md'; to = 'docs\guides\code-maps.md' },
  @{ from = 'docs\structural-search.md'; to = 'docs\guides\structural-search.md' },
  @{ from = 'docs\embeddings.md'; to = 'docs\guides\embeddings.md' },
  @{ from = 'docs\query-cache.md'; to = 'docs\guides\query-cache.md' },
  @{ from = 'docs\ast-feature-list.md'; to = 'docs\language\ast-feature-list.md' },
  @{ from = 'docs\language-onboarding-playbook.md'; to = 'docs\language\onboarding-playbook.md' },
  @{ from = 'docs\language-fidelity.md'; to = 'docs\language\fidelity.md' },
  @{ from = 'docs\language-benchmarks.md'; to = 'docs\language\benchmarks.md' },
  @{ from = 'docs\parser-backbone.md'; to = 'docs\language\parser-backbone.md' },
  @{ from = 'docs\symbol-sources.md'; to = 'docs\language\symbol-sources.md' },
  @{ from = 'docs\import-links.md'; to = 'docs\language\import-links.md' },
  @{ from = 'docs\ctags.md'; to = 'docs\tooling\ctags.md' },
  @{ from = 'docs\gtags.md'; to = 'docs\tooling\gtags.md' },
  @{ from = 'docs\scip.md'; to = 'docs\tooling\scip.md' },
  @{ from = 'docs\lsif.md'; to = 'docs\tooling\lsif.md' },
  @{ from = 'docs\script-inventory.json'; to = 'docs\tooling\script-inventory.json' },
  @{ from = 'docs\benchmarks.md'; to = 'docs\benchmarks\overview.md' },
  @{ from = 'docs\eval.md'; to = 'docs\benchmarks\evaluation.md' },
  @{ from = 'docs\model-comparison.md'; to = 'docs\benchmarks\model-comparison.md' },
  @{ from = 'docs\model-compare-sqlite.json'; to = 'docs\benchmarks\model-compare-sqlite.json' },
  @{ from = 'docs\parity-sqlite-ann.json'; to = 'docs\benchmarks\sqlite-parity-ann.json' },
  @{ from = 'docs\parity-sqlite-fts-ann.json'; to = 'docs\benchmarks\sqlite-parity-fts-ann.json' },
  @{ from = 'docs\sqlite-ann-extension.md'; to = 'docs\sqlite\ann-extension.md' },
  @{ from = 'docs\sqlite-compaction.md'; to = 'docs\sqlite\compaction.md' },
  @{ from = 'docs\sqlite-incremental-updates.md'; to = 'docs\sqlite\incremental-updates.md' },
  @{ from = 'docs\sqlite-index-schema.md'; to = 'docs\sqlite\index-schema.md' },
  @{ from = 'docs\failing-tests.md'; to = 'docs\testing\failing-tests.md' },
  @{ from = 'docs\ci-capability-policy.md'; to = 'docs\testing\ci-capability-policy.md' },
  @{ from = 'docs\TEST_RUNNER_INTERFACE.md'; to = 'docs\testing\test-runner-interface.md' },
  @{ from = 'docs\TEST_DECOMPOSITION_REGROUPING.md'; to = 'docs\testing\test-decomposition-regrouping.md' },
  @{ from = 'docs\truth-table.md'; to = 'docs\testing\truth-table.md' }
)

foreach ($item in $moveMap) {
  if (Test-Path $item.from) {
    Move-Item -Force $item.from $item.to
  }
}

if (Test-Path 'docs\references') {
  Move-Item -Force 'docs\references' 'docs\dependency_references'
}

$nested = 'docs\dependency_references\references'
if (Test-Path $nested) {
  Get-ChildItem -Path $nested -Force | ForEach-Object {
    Move-Item -Force $_.FullName 'docs\dependency_references'
  }
  Remove-Item -Force -Recurse $nested
}

Get-ChildItem -Path 'docs\dependency_references' -File | Where-Object { $_.Name -match '^[0-9]+-' } | ForEach-Object {
  $newName = $_.Name -replace '^[0-9]+-',''
  if (-not (Test-Path (Join-Path $_.DirectoryName $newName))) {
    Rename-Item -Path $_.FullName -NewName $newName
  }
}

if (Test-Path 'docs\dependency_references\README.md') {
  Rename-Item -Path 'docs\dependency_references\README.md' -NewName 'readme.md'
}

$bundle = 'docs\dependency_references\dependency-bundle'
if (Test-Path $bundle) {
  if (Test-Path (Join-Path $bundle 'README.md')) {
    Rename-Item -Path (Join-Path $bundle 'README.md') -NewName 'readme.md'
  }
  if (Test-Path (Join-Path $bundle 'LINK_INVENTORY.md')) {
    Rename-Item -Path (Join-Path $bundle 'LINK_INVENTORY.md') -NewName 'link-inventory.md'
  }
  if (Test-Path (Join-Path $bundle 'TOPIC_GUIDE.md')) {
    Rename-Item -Path (Join-Path $bundle 'TOPIC_GUIDE.md') -NewName 'topic-guide.md'
  }
}
