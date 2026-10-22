import path from 'node:path';

/** Official CLI stdio launch is distinct from the retired fwcd product. No
 * archive/runtime/license qualification or provider version is inferred here. */
export const KOTLIN_LSP_PRESET = Object.freeze({ id: 'kotlin-lsp', cmd: 'kotlin-lsp', args: Object.freeze(['--stdio']),
  languages: Object.freeze(['kotlin']), label: 'Kotlin (official LSP, Alpha, explicit unqualified profile)',
  explicitOnly: true, profileContractVersion: 1, priority: 80, requiresWorkspaceExecution: true,
  exclusiveLanguageGroup: 'kotlin-semantic', preflightPolicy: 'required', requireWorkspaceModel: true,
  workspaceMarkerOptions: Object.freeze({ exactNames: Object.freeze(['pom.xml', 'build.gradle', 'build.gradle.kts',
    'settings.gradle', 'settings.gradle.kts']) }),
  workspaceModelMissingMessage: 'Official Kotlin LSP requires an explicit Gradle/Maven workspace model; target support remains unqualified.' });

export const isRetiredKotlinLspSelection = server => {
  const keys = [server?.preset, server?.id, path.basename(String(server?.cmd || '')).replace(/\.(exe|cmd|bat)$/iu, '')]
    .map(value => String(value || '').trim().toLowerCase());
  return keys.includes('kotlin-language-server');
};

export const kotlinLspMigrationDiagnostic = () => ({ state: 'blocked', blockProvider: true,
  reasonCode: 'kotlin_fwcd_migration_required', message: 'The fwcd kotlin-language-server profile is retired. Select the distinct official kotlin-lsp profile and admit its actual installation/runtime; no fallback product is launched.',
  check: { name: 'kotlin_fwcd_migration_required', status: 'warn',
    message: 'Retired fwcd Kotlin server configuration requires an explicit official kotlin-lsp selection.' } });

/** Kotlin scripts are executable build/script inputs, not plain JVM sources.
 * The initial explicit service route admits existing .kt documents only; its
 * source-set, Android and Multiplatform readiness is not inferred from a suffix. */
export const admitKotlinLspInputs = ({ profileId, inputs }) => {
  const documents = Array.isArray(inputs?.documents) ? inputs.documents : [], targets = Array.isArray(inputs?.targets) ? inputs.targets : [];
  if (profileId !== 'kotlin-lsp') return { ...inputs, documents, targets, checks: Array.isArray(inputs?.checks) ? inputs.checks : [] };
  const admitted = documents.filter(document => path.extname(String(document.containerPath || document.virtualPath || '').split('#')[0]).toLowerCase() === '.kt');
  const paths = new Set(admitted.map(document => document.virtualPath));
  const rejected = documents.length - admitted.length;
  return { ...inputs, documents: admitted, targets: targets.filter(target => paths.has(target.virtualPath)),
    checks: [...(Array.isArray(inputs?.checks) ? inputs.checks : []), ...(rejected ? [{ name: 'kotlin_lsp_unsupported_document_dialect',
      status: 'warn', message: `Official Kotlin LSP excluded ${rejected} document(s) outside the initial .kt source route; script/target support remains unqualified.` }] : [])] };
};
