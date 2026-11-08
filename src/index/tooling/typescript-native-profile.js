import path from 'node:path';
import { resolveManagedToolInstallation } from '../../shared/managed-installation.js';
import { resolveStorageLayout } from '../../shared/storage/layout.js';

export const TYPESCRIPT_NATIVE_VERSION = '7.0.2';
export const TYPESCRIPT_NATIVE_RECIPE = 'microsoft-typescript-native-platform-package';
export const TYPESCRIPT_NATIVE_PROFILE = 'typescript-native-lsp-v1';
export const TYPESCRIPT_NATIVE_PRESET = Object.freeze({
  id: 'typescript-native', cmd: 'typescript-native', args: Object.freeze(['--lsp', '--stdio']),
  languages: Object.freeze(['javascript', 'typescript', 'javascriptreact', 'typescriptreact']),
  label: 'JavaScript/TypeScript (TypeScript 7 native LSP, explicit qualification profile)',
  explicitOnly: true, profileContractVersion: 1, priority: 70, preflightPolicy: 'required',
  requiresWorkspaceExecution: true,
  protocolProfile: TYPESCRIPT_NATIVE_PROFILE,
  exclusiveLanguageGroup: 'javascript-typescript-semantic', replacesProviderIds: Object.freeze(['typescript']),
  initializationOptions: Object.freeze({ enableTelemetry: false, disablePushDiagnostics: true,
    userPreferences: Object.freeze({ automaticTypeAcquisitionEnabled: false }),
    settings: Object.freeze({ 'js/ts': Object.freeze({ tsserver: Object.freeze({
      automaticTypeAcquisition: Object.freeze({ enabled: false })
    }) }) }) })
});

/** A default native selection never resolves to a PATH tsc/tsserver or the
 * programmatic compiler bridge. Explicit command paths keep normal authority. */
export const resolveTypeScriptNativeCommand = toolingRoot => {
  const selected = resolveManagedToolInstallation(toolingRoot || resolveStorageLayout().descriptors.tooling.path, 'typescript-native');
  if (!selected || selected.recipeId !== TYPESCRIPT_NATIVE_RECIPE || selected.version !== TYPESCRIPT_NATIVE_VERSION
    || selected.command !== path.join(selected.root, 'lib', 'tsc.exe')) return '';
  return selected.command;
};

export const assertTypeScriptNativeInitialize = result => {
  if (result?.serverInfo?.name !== 'typescript-go' || result.serverInfo.version !== TYPESCRIPT_NATIVE_VERSION) {
    throw Object.assign(new Error('The native TypeScript profile requires typescript-go ' + TYPESCRIPT_NATIVE_VERSION + '; another compiler/server is not a fallback.'),
      { code: 'ERR_TOOLING_TYPESCRIPT_NATIVE_IDENTITY' });
  }
};

/** Embedded template/framework documents need a qualified adapter. Plain source
 * selection does not establish Vue/Svelte/MDX/plugin compatibility. */
export const admitTypeScriptNativeInputs = inputs => {
  const documents = Array.isArray(inputs?.documents) ? inputs.documents : [], targets = Array.isArray(inputs?.targets) ? inputs.targets : [];
  const admitted = documents.filter(document => typeof document.virtualPath === 'string' && document.virtualPath.length
    && /\.(?:[cm]?[jt]s|[jt]sx)$/iu.test(String(document.containerPath || document.virtualPath)));
  const paths = new Set(admitted.map(document => document.virtualPath));
  return { ...inputs, documents: admitted, targets: targets.filter(target => paths.has(target.virtualPath)),
    checks: [...(Array.isArray(inputs?.checks) ? inputs.checks : []), ...(documents.length > admitted.length ? [{
      name: 'typescript_native_unsupported_document', status: 'warn',
      message: 'Native TypeScript excluded embedded/framework documents outside the qualified plain JS/TS source route.'
    }] : [])] };
};
