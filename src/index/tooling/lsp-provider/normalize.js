import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hashProviderConfig,
  normalizePreflightPolicy,
  normalizePreflightRuntimeRequirements,
  normalizeProviderId,
  PREFLIGHT_POLICY
} from '../provider-contract.js';
import { listLspServerPresets, resolveLspServerPreset } from '../lsp-presets.js';
import {
  deepCloneValue,
  deepMergeObjects,
  isPlainObject,
  normalizeCommandArgs,
  normalizeStringList
} from '../provider-utils.js';

export const normalizeList = (value) => normalizeStringList(value);

export const normalizeArgs = (value) => normalizeCommandArgs(value);

export const normalizeHoverSymbolKinds = (value) => {
  const source = Array.isArray(value) ? value : [value];
  const normalized = source
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry))
    .map((entry) => Math.floor(entry));
  return normalized.length ? normalized : null;
};

export const normalizeServerId = (value, fallback) => {
  const base = normalizeProviderId(value || fallback || 'lsp');
  const safe = base.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return safe || 'lsp';
};

export const normalizeLanguageList = (value) => normalizeList(value).map((entry) => entry.toLowerCase());

export const normalizeKindList = (value) => normalizeList(value).map((entry) => entry.toLowerCase());

export const withLuaWorkspaceLibrary = (initializationOptions, luaWorkspaceLibrary) => {
  const libraries = normalizeList(luaWorkspaceLibrary);
  if (!libraries.length) return initializationOptions;
  const next = isPlainObject(initializationOptions)
    ? deepCloneValue(initializationOptions)
    : {};
  const settings = isPlainObject(next.settings) ? next.settings : {};
  const luaSettings = isPlainObject(settings.Lua) ? settings.Lua : {};
  const workspace = isPlainObject(luaSettings.workspace) ? luaSettings.workspace : {};
  workspace.library = libraries;
  luaSettings.workspace = workspace;
  settings.Lua = luaSettings;
  next.settings = settings;
  return next;
};

export const normalizeLuaWorkspaceLibraryEntries = (initializationOptions) => {
  const libraries = initializationOptions?.settings?.Lua?.workspace?.library;
  if (!Array.isArray(libraries)) return [];
  return libraries
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
};

export const resolveLuaWorkspaceLibraryPath = (repoRoot, value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[a-z]+:\/\//i.test(raw)) {
    if (!raw.toLowerCase().startsWith('file://')) return '';
    try {
      return fileURLToPath(raw);
    } catch {
      return '';
    }
  }
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(repoRoot || process.cwd(), raw);
};

export const LUA_WORKSPACE_CONFIG_MAX_BYTES = 1024 * 1024;

export const normalizeServerConfig = (server, index) => {
  if (!server || typeof server !== 'object') return null;
  const preset = resolveLspServerPreset(server);
  const merged = preset
    ? { ...preset, ...server }
    : server;
  if (preset && isPlainObject(preset.initializationOptions) && isPlainObject(server.initializationOptions)) {
    merged.initializationOptions = deepMergeObjects(preset.initializationOptions, server.initializationOptions);
  }
  const id = normalizeServerId(merged.id, `lsp-${index + 1}`);
  const providerId = merged.providerId
    ? normalizeServerId(merged.providerId, id)
    : null;
  const cmd = String(merged.cmd || '').trim();
  if (!cmd) return null;
  const args = normalizeArgs(merged.args);
  const languages = normalizeLanguageList(merged.languages);
  const kinds = normalizeKindList(merged.kinds);
  const uriScheme = merged.uriScheme === 'poc-vfs' ? 'poc-vfs' : 'file';
  const timeoutMs = Number(merged.timeoutMs);
  const documentSymbolTimeoutMs = Number(merged.documentSymbolTimeoutMs);
  const hoverTimeoutMs = Number(merged.hoverTimeoutMs);
  const signatureHelpTimeoutMs = Number(merged.signatureHelpTimeoutMs);
  const definitionTimeoutMs = Number(merged.definitionTimeoutMs);
  const typeDefinitionTimeoutMs = Number(merged.typeDefinitionTimeoutMs);
  const referencesTimeoutMs = Number(merged.referencesTimeoutMs);
  const retries = Number(merged.retries);
  const priority = Number(merged.priority);
  const documentSymbolConcurrency = Number(merged.documentSymbolConcurrency);
  const hoverConcurrency = Number(merged.hoverConcurrency);
  const signatureHelpConcurrency = Number(merged.signatureHelpConcurrency);
  const definitionConcurrency = Number(merged.definitionConcurrency);
  const typeDefinitionConcurrency = Number(merged.typeDefinitionConcurrency);
  const referencesConcurrency = Number(merged.referencesConcurrency);
  const requestCacheMaxEntries = Number(merged.requestCacheMaxEntries);
  const hoverMaxPerFile = Number(merged.hoverMaxPerFile);
  const hoverDisableAfterTimeouts = Number(merged.hoverDisableAfterTimeouts);
  const hoverEnabled = typeof merged.hoverEnabled === 'boolean'
    ? merged.hoverEnabled
    : (typeof merged.hover === 'boolean' ? merged.hover : null);
  const signatureHelpEnabled = typeof merged.signatureHelpEnabled === 'boolean'
    ? merged.signatureHelpEnabled
    : (typeof merged.signatureHelp === 'boolean' ? merged.signatureHelp : null);
  const definitionEnabled = typeof merged.definitionEnabled === 'boolean'
    ? merged.definitionEnabled
    : (typeof merged.definition === 'boolean' ? merged.definition : null);
  const typeDefinitionEnabled = typeof merged.typeDefinitionEnabled === 'boolean'
    ? merged.typeDefinitionEnabled
    : (typeof merged.typeDefinition === 'boolean' ? merged.typeDefinition : null);
  const referencesEnabled = typeof merged.referencesEnabled === 'boolean'
    ? merged.referencesEnabled
    : (typeof merged.references === 'boolean' ? merged.references : null);
  const semanticTokensEnabled = typeof merged.semanticTokensEnabled === 'boolean'
    ? merged.semanticTokensEnabled
    : (typeof merged.semanticTokens === 'boolean' ? merged.semanticTokens : null);
  const inlayHintsEnabled = typeof merged.inlayHintsEnabled === 'boolean'
    ? merged.inlayHintsEnabled
    : (typeof merged.inlayHints === 'boolean' ? merged.inlayHints : null);
  const hoverRequireMissingReturn = typeof merged.hoverRequireMissingReturn === 'boolean'
    ? merged.hoverRequireMissingReturn
    : null;
  const hoverSymbolKinds = normalizeHoverSymbolKinds(merged.hoverSymbolKinds);
  const breakerThreshold = Number(merged.circuitBreakerThreshold);
  const requireWorkspaceModel = typeof merged.requireWorkspaceModel === 'boolean'
    ? merged.requireWorkspaceModel
    : null;
  const workspaceMarkerOptions = isPlainObject(merged.workspaceMarkerOptions)
    ? deepCloneValue(merged.workspaceMarkerOptions)
    : null;
  const workspaceModelPolicyRaw = String(merged.workspaceModelPolicy || '').trim().toLowerCase();
  const workspaceModelPolicy = workspaceModelPolicyRaw === 'block' ? 'block' : 'warn';
  const preflightClassRaw = String(merged.preflightClass || '').trim().toLowerCase();
  const preflightClass = preflightClassRaw === 'dependency'
    ? 'dependency'
    : (preflightClassRaw === 'workspace' ? 'workspace' : null);
  const preflightTimeoutMs = Number(merged.preflightTimeoutMs);
  const goWorkspaceModuleCmd = String(merged.goWorkspaceModuleCmd || '').trim();
  const goWorkspaceModuleArgs = Array.isArray(merged.goWorkspaceModuleArgs)
    ? merged.goWorkspaceModuleArgs.map((entry) => String(entry))
    : null;
  const goWorkspaceModuleTimeoutMs = Number(merged.goWorkspaceModuleTimeoutMs);
  const goWorkspaceWarmup = typeof merged.goWorkspaceWarmup === 'boolean'
    ? merged.goWorkspaceWarmup
    : null;
  const goWorkspaceWarmupCmd = String(merged.goWorkspaceWarmupCmd || '').trim();
  const goWorkspaceWarmupArgs = Array.isArray(merged.goWorkspaceWarmupArgs)
    ? merged.goWorkspaceWarmupArgs.map((entry) => String(entry))
    : null;
  const goWorkspaceWarmupTimeoutMs = Number(merged.goWorkspaceWarmupTimeoutMs);
  const goWorkspaceWarmupMinGoFiles = Number(merged.goWorkspaceWarmupMinGoFiles);
  const goWorkspaceWarmupScanBudget = Number(merged.goWorkspaceWarmupScanBudget);
  const goWorkspaceWarmupScanMaxDepth = Number(merged.goWorkspaceWarmupScanMaxDepth);
  const rustWorkspaceMetadataCmd = String(merged.rustWorkspaceMetadataCmd || '').trim();
  const rustWorkspaceMetadataArgs = Array.isArray(merged.rustWorkspaceMetadataArgs)
    ? merged.rustWorkspaceMetadataArgs.map((entry) => String(entry))
    : null;
  const rustWorkspaceMetadataTimeoutMs = Number(merged.rustWorkspaceMetadataTimeoutMs);
  const workspaceModelMissingMessage = typeof merged.workspaceModelMissingMessage === 'string'
    ? merged.workspaceModelMissingMessage.trim()
    : '';
  const presetName = String(merged.preset || '').trim().toLowerCase();
  const usesLuaPreset = presetName === 'lua'
    || presetName === 'lua_ls'
    || presetName === 'lua-language-server'
    || id === 'lua-language-server';
  const baseInitializationOptions = isPlainObject(merged.initializationOptions)
    ? merged.initializationOptions
    : null;
  const initializationOptions = withLuaWorkspaceLibrary(
    baseInitializationOptions,
    usesLuaPreset ? merged.luaWorkspaceLibrary : null
  );
  const adaptiveDocScope = isPlainObject(merged.adaptiveDocScope)
    ? deepCloneValue(merged.adaptiveDocScope)
    : null;
  const lifecycle = isPlainObject(merged.lifecycle)
    ? deepCloneValue(merged.lifecycle)
    : null;
  const rustSuppressProcMacroDiagnosticsExplicit = Object.prototype.hasOwnProperty.call(
    merged,
    'rustSuppressProcMacroDiagnostics'
  );
  const rustSuppressProcMacroDiagnostics = id === 'rust-analyzer'
    ? merged.rustSuppressProcMacroDiagnostics !== false
    : false;
  const resolvedWorkspaceMarkerOptions = (
    requireWorkspaceModel === false
      ? null
      : (workspaceMarkerOptions || (id === 'gopls'
        ? { exactNames: ['go.mod', 'go.work'] }
        : null))
  );
  const resolvedWorkspaceModelMissingMessage = (
    workspaceModelMissingMessage
      || (id === 'gopls'
        ? 'gopls workspace markers (go.mod/go.work) not found near repo root.'
        : `${id} workspace model markers not found near repo root.`)
  );
  const defaultPreflightPolicy = (
    resolvedWorkspaceMarkerOptions && requireWorkspaceModel !== false
      ? PREFLIGHT_POLICY.REQUIRED
      : PREFLIGHT_POLICY.OPTIONAL
  );
  const preflightPolicy = normalizePreflightPolicy(merged.preflightPolicy, defaultPreflightPolicy);
  const preflightRuntimeRequirements = normalizePreflightRuntimeRequirements(
    merged.preflightRuntimeRequirements || merged.runtimeRequirements
  );
  return {
    id,
    providerId,
    cmd,
    args,
    languages,
    kinds,
    uriScheme,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.max(1000, Math.floor(timeoutMs)) : null,
    documentSymbolTimeoutMs: Number.isFinite(documentSymbolTimeoutMs)
      ? Math.max(1000, Math.floor(documentSymbolTimeoutMs))
      : null,
    hoverTimeoutMs: Number.isFinite(hoverTimeoutMs)
      ? Math.max(1000, Math.floor(hoverTimeoutMs))
      : null,
    signatureHelpTimeoutMs: Number.isFinite(signatureHelpTimeoutMs)
      ? Math.max(1000, Math.floor(signatureHelpTimeoutMs))
      : null,
    definitionTimeoutMs: Number.isFinite(definitionTimeoutMs)
      ? Math.max(1000, Math.floor(definitionTimeoutMs))
      : null,
    typeDefinitionTimeoutMs: Number.isFinite(typeDefinitionTimeoutMs)
      ? Math.max(1000, Math.floor(typeDefinitionTimeoutMs))
      : null,
    referencesTimeoutMs: Number.isFinite(referencesTimeoutMs)
      ? Math.max(1000, Math.floor(referencesTimeoutMs))
      : null,
    retries: Number.isFinite(retries) ? Math.max(0, Math.floor(retries)) : null,
    circuitBreakerThreshold: Number.isFinite(breakerThreshold)
      ? Math.max(1, Math.floor(breakerThreshold))
      : null,
    documentSymbolConcurrency: Number.isFinite(documentSymbolConcurrency)
      ? Math.max(1, Math.floor(documentSymbolConcurrency))
      : null,
    hoverConcurrency: Number.isFinite(hoverConcurrency)
      ? Math.max(1, Math.floor(hoverConcurrency))
      : null,
    signatureHelpConcurrency: Number.isFinite(signatureHelpConcurrency)
      ? Math.max(1, Math.floor(signatureHelpConcurrency))
      : null,
    definitionConcurrency: Number.isFinite(definitionConcurrency)
      ? Math.max(1, Math.floor(definitionConcurrency))
      : null,
    typeDefinitionConcurrency: Number.isFinite(typeDefinitionConcurrency)
      ? Math.max(1, Math.floor(typeDefinitionConcurrency))
      : null,
    referencesConcurrency: Number.isFinite(referencesConcurrency)
      ? Math.max(1, Math.floor(referencesConcurrency))
      : null,
    requestCacheMaxEntries: Number.isFinite(requestCacheMaxEntries)
      ? Math.max(1000, Math.floor(requestCacheMaxEntries))
      : null,
    hoverMaxPerFile: Number.isFinite(hoverMaxPerFile)
      ? Math.max(0, Math.floor(hoverMaxPerFile))
      : null,
    hoverDisableAfterTimeouts: Number.isFinite(hoverDisableAfterTimeouts)
      ? Math.max(1, Math.floor(hoverDisableAfterTimeouts))
      : null,
    hoverEnabled,
    signatureHelpEnabled,
    definitionEnabled,
    typeDefinitionEnabled,
    referencesEnabled,
    semanticTokensEnabled,
    inlayHintsEnabled,
    hoverRequireMissingReturn,
    hoverSymbolKinds,
    rustSuppressProcMacroDiagnostics,
    rustSuppressProcMacroDiagnosticsExplicit,
    requireWorkspaceModel,
    workspaceMarkerOptions: resolvedWorkspaceMarkerOptions,
    workspaceModelPolicy,
    preflightClass,
    preflightTimeoutMs: Number.isFinite(preflightTimeoutMs)
      ? Math.max(500, Math.floor(preflightTimeoutMs))
      : null,
    preflightPolicy,
    preflightRuntimeRequirements,
    goWorkspaceModuleCmd: goWorkspaceModuleCmd || null,
    goWorkspaceModuleArgs: goWorkspaceModuleArgs?.length ? goWorkspaceModuleArgs : null,
    goWorkspaceModuleTimeoutMs: Number.isFinite(goWorkspaceModuleTimeoutMs)
      ? Math.max(500, Math.floor(goWorkspaceModuleTimeoutMs))
      : null,
    goWorkspaceWarmup,
    goWorkspaceWarmupCmd: goWorkspaceWarmupCmd || null,
    goWorkspaceWarmupArgs: goWorkspaceWarmupArgs?.length ? goWorkspaceWarmupArgs : null,
    goWorkspaceWarmupTimeoutMs: Number.isFinite(goWorkspaceWarmupTimeoutMs)
      ? Math.max(500, Math.floor(goWorkspaceWarmupTimeoutMs))
      : null,
    goWorkspaceWarmupMinGoFiles: Number.isFinite(goWorkspaceWarmupMinGoFiles)
      ? Math.max(1, Math.floor(goWorkspaceWarmupMinGoFiles))
      : null,
    goWorkspaceWarmupScanBudget: Number.isFinite(goWorkspaceWarmupScanBudget)
      ? Math.max(100, Math.floor(goWorkspaceWarmupScanBudget))
      : null,
    goWorkspaceWarmupScanMaxDepth: Number.isFinite(goWorkspaceWarmupScanMaxDepth)
      ? Math.max(1, Math.floor(goWorkspaceWarmupScanMaxDepth))
      : null,
    rustWorkspaceMetadataCmd: rustWorkspaceMetadataCmd || null,
    rustWorkspaceMetadataArgs: rustWorkspaceMetadataArgs?.length ? rustWorkspaceMetadataArgs : null,
    rustWorkspaceMetadataTimeoutMs: Number.isFinite(rustWorkspaceMetadataTimeoutMs)
      ? Math.max(500, Math.floor(rustWorkspaceMetadataTimeoutMs))
      : null,
    workspaceModelMissingMessage: resolvedWorkspaceModelMissingMessage,
    lifecycle,
    lifecycleRestartWindowMs: merged.lifecycleRestartWindowMs,
    lifecycleMaxRestartsPerWindow: merged.lifecycleMaxRestartsPerWindow,
    lifecycleFdPressureBackoffMs: merged.lifecycleFdPressureBackoffMs,
    initializationOptions,
    adaptiveDocScope,
    priority: Number.isFinite(priority) ? priority : null,
    label: typeof merged.label === 'string' ? merged.label : null,
    version: typeof merged.version === 'string' ? merged.version : null
  };
};

export const collectAutoPresetServers = (toolingConfig, configuredServerIds) => {
  if (toolingConfig?.autoEnableOnDetect !== true) return [];
  const lspConfig = toolingConfig?.lsp && typeof toolingConfig.lsp === 'object'
    ? toolingConfig.lsp
    : {};
  if (lspConfig.autoPresets === false) return [];
  const disabledTools = new Set(normalizeList(toolingConfig?.disabledTools).map((entry) => entry.toLowerCase()));
  const enabledTools = normalizeList(toolingConfig?.enabledTools).map((entry) => entry.toLowerCase());
  const hasEnabledAllowlist = enabledTools.length > 0;
  const enabledSet = hasEnabledAllowlist ? new Set(enabledTools) : null;
  const autoServers = [];
  for (const preset of listLspServerPresets()) {
    const serverId = normalizeServerId(preset.id, preset.id);
    if (!serverId) continue;
    if (configuredServerIds.has(serverId)) continue;
    if (disabledTools.has(serverId)) continue;
    if (hasEnabledAllowlist && !enabledSet.has(serverId)) continue;
    autoServers.push({
      ...preset,
      id: serverId,
      providerId: serverId
    });
  }
  return autoServers;
};

export const buildConfiguredProviderConfigHash = ({ server, ctx }) => (
  hashProviderConfig({ server, lsp: ctx?.toolingConfig?.lsp || {} })
);
