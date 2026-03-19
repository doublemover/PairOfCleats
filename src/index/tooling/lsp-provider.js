import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { readJsonFileSafe } from '../../shared/files.js';
import {
  appendDiagnosticChecks,
  hashProviderConfig,
  normalizePreflightPolicy,
  normalizePreflightRuntimeRequirements,
  normalizeProviderId,
  PREFLIGHT_POLICY,
  shouldCaptureDiagnosticsForRequestedKinds
} from './provider-contract.js';
import {
  invalidateProbeCacheOnInitializeFailure
} from './command-resolver.js';
import { listLspServerPresets, resolveLspServerPreset } from './lsp-presets.js';
import { parseClikeSignature } from './signature-parse/clike.js';
import { parseElixirSignature } from './signature-parse/elixir.js';
import { parseGoSignature } from './signature-parse/go.js';
import { parseHaskellSignature } from './signature-parse/haskell.js';
import { parseLuaSignature } from './signature-parse/lua.js';
import { parsePythonSignature } from './signature-parse/python.js';
import { parseRubySignature } from './signature-parse/ruby.js';
import { parseRustSignature } from './signature-parse/rust.js';
import { parseSwiftSignature } from './signature-parse/swift.js';
import { parseZigSignature } from './signature-parse/zig.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';
import { isPlainObject, normalizeCommandArgs } from './provider-utils.js';
import { awaitToolingProviderPreflight } from './preflight-manager.js';
import {
  mergePreflightChecks,
  resolveCommandProfilePreflightResult,
  resolveRuntimeCommandFromPreflight
} from './preflight/command-profile-preflight.js';
import { resolveRuntimeRequirementsPreflight } from './preflight/runtime-requirements-preflight.js';
import { resolveGoWorkspaceModulePreflight } from './preflight/go-workspace-preflight.js';
import { resolveRustWorkspaceMetadataPreflight } from './preflight/rust-workspace-preflight.js';
import { resolveWorkspaceModelPreflight } from './preflight/workspace-model-preflight.js';
import { resolveLspStartupDocuments } from '../../integrations/tooling/providers/lsp/path-policy.js';
import {
  formatLspWorkspacePartitionLogLine,
  mergeLspWorkspacePartitionResults,
  resolveLspWorkspaceRouting
} from './lsp-workspace-routing.js';

const normalizeList = (value) => {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return [];
};

const normalizeArgs = (value) => normalizeCommandArgs(value);

const normalizeHoverSymbolKinds = (value) => {
  const source = Array.isArray(value) ? value : [value];
  const normalized = source
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry))
    .map((entry) => Math.floor(entry));
  return normalized.length ? normalized : null;
};

const normalizeServerId = (value, fallback) => {
  const base = normalizeProviderId(value || fallback || 'lsp');
  const safe = base.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return safe || 'lsp';
};

const normalizeLanguageList = (value) => normalizeList(value).map((entry) => entry.toLowerCase());

const normalizeKindList = (value) => normalizeList(value).map((entry) => entry.toLowerCase());

const deepCloneValue = (value) => {
  if (Array.isArray(value)) return value.map((entry) => deepCloneValue(entry));
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = deepCloneValue(entry);
    }
    return out;
  }
  return value;
};

const deepMergeObjects = (base, override) => {
  const output = isPlainObject(base) ? deepCloneValue(base) : {};
  if (!isPlainObject(override)) return output;
  for (const [key, entry] of Object.entries(override)) {
    if (isPlainObject(entry) && isPlainObject(output[key])) {
      output[key] = deepMergeObjects(output[key], entry);
    } else {
      output[key] = deepCloneValue(entry);
    }
  }
  return output;
};

const withLuaWorkspaceLibrary = (initializationOptions, luaWorkspaceLibrary) => {
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

const normalizeLuaWorkspaceLibraryEntries = (initializationOptions) => {
  const libraries = initializationOptions?.settings?.Lua?.workspace?.library;
  if (!Array.isArray(libraries)) return [];
  return libraries
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
};

const resolveLuaWorkspaceLibraryPath = (repoRoot, value) => {
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

const LUA_WORKSPACE_CONFIG_MAX_BYTES = 1024 * 1024;

const resolveLuaWorkspaceLibraryPreflight = ({ server, repoRoot }) => {
  const serverId = String(server?.id || '').trim().toLowerCase();
  const languages = Array.isArray(server?.languages)
    ? server.languages.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
    : [];
  if (serverId !== 'lua-language-server' && !languages.includes('lua')) {
    return { state: 'ready', reasonCode: null, message: '', check: null };
  }
  const libraries = normalizeLuaWorkspaceLibraryEntries(server?.initializationOptions);
  if (!libraries.length) {
    return { state: 'ready', reasonCode: null, message: '', check: null };
  }
  const missing = [];
  for (const entry of libraries) {
    const candidatePath = resolveLuaWorkspaceLibraryPath(repoRoot, entry);
    if (!candidatePath) continue;
    if (!fsSync.existsSync(candidatePath)) {
      missing.push(entry);
    }
  }
  if (!missing.length) {
    return { state: 'ready', reasonCode: null, message: '', check: null };
  }
  const samples = missing.slice(0, 3).join(', ');
  const suffix = missing.length > 3 ? ` (+${missing.length - 3} more)` : '';
  const message = `lua workspace library path(s) missing: ${samples}${suffix}`;
  return {
    state: 'degraded',
    reasonCode: 'lua_workspace_library_missing',
    message,
    check: {
      name: 'lua_workspace_library_missing',
      status: 'warn',
      message
    }
  };
};

const resolveLuaWorkspaceConfigPreflight = async ({ server, repoRoot }) => {
  const serverId = String(server?.id || '').trim().toLowerCase();
  const languages = Array.isArray(server?.languages)
    ? server.languages.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
    : [];
  if (serverId !== 'lua-language-server' && !languages.includes('lua')) {
    return { state: 'ready', reasonCode: null, message: '', check: null };
  }
  const configPath = path.join(repoRoot || process.cwd(), '.luarc.json');
  if (!fsSync.existsSync(configPath)) {
    return { state: 'ready', reasonCode: null, message: '', check: null };
  }
  let readError = null;
  const parsed = await readJsonFileSafe(configPath, {
    fallback: null,
    maxBytes: LUA_WORKSPACE_CONFIG_MAX_BYTES,
    onError: (info) => {
      readError = info;
    }
  });
  if (!readError) {
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { state: 'ready', reasonCode: null, message: '', check: null };
    }
    const message = 'lua workspace config (.luarc.json) must be a JSON object.';
    return {
      state: 'degraded',
      reasonCode: 'lua_workspace_config_invalid',
      message,
      check: {
        name: 'lua_workspace_config_invalid',
        status: 'warn',
        message
      }
    };
  }
  const errorCode = String(readError?.error?.code || '').trim().toUpperCase();
  if (errorCode === 'ERR_JSON_FILE_TOO_LARGE') {
    const message = `lua workspace config exceeds ${LUA_WORKSPACE_CONFIG_MAX_BYTES} bytes.`;
    return {
      state: 'degraded',
      reasonCode: 'lua_workspace_config_too_large',
      message,
      check: {
        name: 'lua_workspace_config_too_large',
        status: 'warn',
        message
      }
    };
  }
  const message = String(readError?.phase || '').toLowerCase() === 'parse'
    ? `lua workspace config is invalid JSON: ${readError?.error?.message || 'parse failed'}`
    : `lua workspace config unreadable: ${readError?.error?.message || 'read failed'}`;
  const reasonCode = String(readError?.phase || '').toLowerCase() === 'parse'
    ? 'lua_workspace_config_invalid'
    : 'lua_workspace_config_unreadable';
  return {
    state: 'degraded',
    reasonCode,
    message,
    check: {
      name: reasonCode,
      status: 'warn',
      message
    }
  };
};

const resolveYamlSchemaModePreflight = ({ server }) => {
  const serverId = String(server?.id || '').trim().toLowerCase();
  const languages = Array.isArray(server?.languages)
    ? server.languages.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
    : [];
  if (serverId !== 'yaml-language-server' && !languages.includes('yaml') && !languages.includes('yml')) {
    return { state: 'ready', reasonCode: null, message: '', check: null };
  }
  const enabled = server?.initializationOptions?.settings?.yaml?.schemaStore?.enable;
  if (enabled !== true) {
    return { state: 'ready', reasonCode: null, message: '', check: null };
  }
  const message = 'yaml schemaStore remote fetch is enabled; this may introduce network-latency variability.';
  return {
    state: 'degraded',
    reasonCode: 'yaml_schema_store_remote_enabled',
    message,
    check: {
      name: 'yaml_schema_store_remote_enabled',
      status: 'warn',
      message
    }
  };
};

const ZIG_WORKSPACE_MARKER_NAMES = new Set(['build.zig', 'build.zig.zon']);

const resolveZigWorkspaceRootPreflight = ({ server, repoRoot }) => {
  const serverId = String(server?.id || '').trim().toLowerCase();
  const languages = Array.isArray(server?.languages)
    ? server.languages.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
    : [];
  if (serverId !== 'zls' && !languages.includes('zig')) {
    return { state: 'ready', reasonCode: null, message: '', check: null };
  }
  let rootEntries = [];
  try {
    rootEntries = fsSync.readdirSync(repoRoot || process.cwd(), { withFileTypes: true });
  } catch {
    return { state: 'ready', reasonCode: null, message: '', check: null };
  }
  const rootHasMarker = rootEntries.some((entry) => (
    entry?.isFile?.() && ZIG_WORKSPACE_MARKER_NAMES.has(String(entry.name || '').toLowerCase())
  ));
  if (rootHasMarker) {
    return { state: 'ready', reasonCode: null, message: '', check: null };
  }
  const nestedMarkerDirs = [];
  for (const entry of rootEntries) {
    if (!entry?.isDirectory?.()) continue;
    try {
      const childEntries = fsSync.readdirSync(path.join(repoRoot || process.cwd(), entry.name), { withFileTypes: true });
      const hasNestedMarker = childEntries.some((child) => (
        child?.isFile?.() && ZIG_WORKSPACE_MARKER_NAMES.has(String(child.name || '').toLowerCase())
      ));
      if (hasNestedMarker) nestedMarkerDirs.push(String(entry.name || ''));
    } catch {
      // ignore unreadable nested directories for this advisory-only preflight.
    }
  }
  if (!nestedMarkerDirs.length) {
    return { state: 'ready', reasonCode: null, message: '', check: null };
  }
  if (nestedMarkerDirs.length === 1) {
    const message = `zls workspace marker found only in nested directory "${nestedMarkerDirs[0]}"; set workspace root explicitly for stable resolution.`;
    return {
      state: 'degraded',
      reasonCode: 'zls_workspace_nested_root',
      message,
      check: {
        name: 'zls_workspace_nested_root',
        status: 'warn',
        message
      }
    };
  }
  const samples = nestedMarkerDirs.slice(0, 3).join(', ');
  const suffix = nestedMarkerDirs.length > 3 ? ` (+${nestedMarkerDirs.length - 3} more)` : '';
  const message = `zls workspace markers found in multiple nested directories (${samples}${suffix}); workspace root is ambiguous.`;
  return {
    state: 'degraded',
    reasonCode: 'zls_workspace_ambiguous_root',
    message,
    check: {
      name: 'zls_workspace_ambiguous_root',
      status: 'warn',
      message
    }
  };
};

const resolveRustProcMacroSuppressionPolicyPreflight = ({ server }) => {
  const serverId = String(server?.id || '').trim().toLowerCase();
  const languages = Array.isArray(server?.languages)
    ? server.languages.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const isRustServer = serverId === 'rust-analyzer' || languages.includes('rust');
  if (!isRustServer) {
    return { state: 'ready', reasonCode: null, message: '', check: null };
  }
  if (server?.rustSuppressProcMacroDiagnostics !== true || server?.rustSuppressProcMacroDiagnosticsExplicit !== true) {
    return { state: 'ready', reasonCode: null, message: '', check: null };
  }
  const message = 'rust proc-macro non-fatal diagnostics suppression policy is enabled; warning diagnostics may be intentionally filtered.';
  return {
    state: 'degraded',
    reasonCode: 'rust_workspace_proc_macro_suppression_active',
    message,
    check: {
      name: 'rust_workspace_proc_macro_suppression_active',
      status: 'warn',
      message
    }
  };
};

const resolveFirstNonReadyPreflight = (...entries) => {
  let cachedReady = null;
  for (const entry of entries) {
    const state = String(entry?.state || 'ready').trim().toLowerCase() || 'ready';
    if (state !== 'ready') return entry;
    if (!cachedReady && entry?.cached === true) cachedReady = entry;
  }
  return cachedReady || { state: 'ready', reasonCode: null, message: '' };
};

const parseGenericSignature = (detail, languageId, symbolName) => {
  const lang = String(languageId || '').toLowerCase();
  if (lang === 'python' || lang === 'py' || lang === 'pyi') return parsePythonSignature(detail);
  if (lang === 'swift') return parseSwiftSignature(detail);
  if (lang === 'go') return parseGoSignature(detail);
  if (lang === 'haskell' || lang === 'hs') return parseHaskellSignature(detail);
  if (lang === 'rust') return parseRustSignature(detail);
  if (lang === 'elixir' || lang === 'ex' || lang === 'exs') return parseElixirSignature(detail);
  if (lang === 'lua') return parseLuaSignature(detail);
  if (lang === 'ruby' || lang === 'rb') return parseRubySignature(detail);
  if (lang === 'zig') return parseZigSignature(detail);
  if ([
    'c', 'cpp', 'objective-c', 'objective-cpp',
    'java', 'kotlin', 'csharp',
    'javascript', 'jsx', 'typescript', 'tsx',
    'php'
  ].includes(lang)) {
    return parseClikeSignature(detail, symbolName);
  }
  return parseClikeSignature(detail, symbolName)
    || parsePythonSignature(detail)
    || parseSwiftSignature(detail)
    || parseHaskellSignature(detail)
    || parseElixirSignature(detail)
    || parseRubySignature(detail);
};

const shouldSuppressRustProcMacroDiagnostic = (diag) => {
  if (!diag || typeof diag !== 'object') return false;
  const severity = Number(diag.severity);
  if (severity === 1) return false;
  const text = `${diag.message || ''} ${diag.code || ''}`.toLowerCase();
  return text.includes('proc-macro') || text.includes('procedural macro');
};

const applyRustProcMacroSuppression = (diagnosticsByChunkUid) => {
  if (!diagnosticsByChunkUid || typeof diagnosticsByChunkUid !== 'object') {
    return { diagnosticsByChunkUid: {}, diagnosticsCount: 0, suppressedCount: 0 };
  }
  const entries = diagnosticsByChunkUid instanceof Map
    ? Array.from(diagnosticsByChunkUid.entries())
    : Object.entries(diagnosticsByChunkUid);
  const next = {};
  let diagnosticsCount = 0;
  let suppressedCount = 0;
  for (const [chunkUid, diagnostics] of entries) {
    if (!Array.isArray(diagnostics) || !diagnostics.length) continue;
    const kept = [];
    for (const diag of diagnostics) {
      if (shouldSuppressRustProcMacroDiagnostic(diag)) {
        suppressedCount += 1;
        continue;
      }
      kept.push(diag);
    }
    if (!kept.length) continue;
    next[chunkUid] = kept;
    diagnosticsCount += kept.length;
  }
  return {
    diagnosticsByChunkUid: next,
    diagnosticsCount,
    suppressedCount
  };
};

const normalizeServerConfig = (server, index) => {
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

const collectAutoPresetServers = (toolingConfig, configuredServerIds) => {
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

const createConfiguredLspProvider = (server) => {
  const providerId = normalizeServerId(server.providerId, `lsp-${server.id}`);
  const buildCommandUnavailableCheck = (requestedCmd) => ({
    name: 'lsp_command_unavailable',
    status: 'warn',
    message: `${requestedCmd} command probe failed for ${providerId}; attempting stdio initialization anyway.`
  });
  const collectConfiguredOutput = async ({
    ctx,
    provider,
    docs,
    targets,
    requestedKinds = null,
    log,
    preChecks,
    commandProfile,
    requestedCommand,
    preflightState = 'ready',
    preflightReasonCode = null,
    blockedWorkspaceKeys = [],
    blockedWorkspaceRoots = []
  }) => {
    const resolvedCmd = String(commandProfile?.resolved?.cmd || requestedCommand?.cmd || '').trim();
    const resolvedArgs = Array.isArray(commandProfile?.resolved?.args)
      ? commandProfile.resolved.args
      : (Array.isArray(requestedCommand?.args) ? requestedCommand.args : []);
    const runtimeConfig = resolveLspRuntimeConfig({
      providerConfig: server,
      globalConfigs: [ctx?.toolingConfig?.lsp || null, ctx?.toolingConfig || null],
      defaults: {
        timeoutMs: 60000,
        retries: 2,
        breakerThreshold: 3
      }
    });
    const workspaceRouting = resolveLspWorkspaceRouting({
      repoRoot: ctx.repoRoot,
      providerId,
      documents: docs,
      targets,
      workspaceMarkerOptions: server.workspaceMarkerOptions || null,
      requireWorkspaceModel: server.requireWorkspaceModel !== false,
      workspaceModelPolicy: server.workspaceModelPolicy
    });
    if (log) {
      const workspaceLogLine = formatLspWorkspacePartitionLogLine({
        providerId,
        workspaceRouting
      });
      if (workspaceLogLine) log(workspaceLogLine);
    }
    const blockedKeySet = new Set(
      Array.isArray(blockedWorkspaceKeys)
        ? blockedWorkspaceKeys.map((entry) => String(entry || '').trim()).filter(Boolean)
        : []
    );
    const blockedRootSet = new Set(
      Array.isArray(blockedWorkspaceRoots)
        ? blockedWorkspaceRoots.map((entry) => String(entry || '').trim()).filter(Boolean)
        : []
    );
    const skippedBlockedPartitions = [];
    const partitionResults = [];
    for (const partition of workspaceRouting.partitions) {
      if (blockedKeySet.has(String(partition.workspaceKey || '').trim()) || blockedRootSet.has(String(partition.rootRel || '').trim())) {
        skippedBlockedPartitions.push(partition);
        continue;
      }
      partitionResults.push(await collectLspTypes({
        ...runtimeConfig,
        rootDir: ctx.repoRoot,
        workspaceRootDir: partition.rootDir,
        workspaceKey: partition.workspaceKey,
        documents: partition.documents,
        targets: partition.targets,
        abortSignal: ctx?.abortSignal || null,
        log,
        providerId,
        cmd: resolvedCmd,
        args: resolvedArgs,
        parseSignature: parseGenericSignature,
        strict: ctx?.strict !== false,
        vfsRoot: ctx?.buildRoot || ctx.repoRoot,
        uriScheme: server.uriScheme || 'file',
        vfsTokenMode: ctx?.toolingConfig?.vfs?.tokenMode,
        vfsIoBatching: ctx?.toolingConfig?.vfs?.ioBatching,
        vfsColdStartCache: ctx?.toolingConfig?.vfs?.coldStartCache,
        indexDir: ctx?.buildRoot || null,
        cacheRoot: ctx?.cache?.dir || null,
        documentSymbolConcurrency: server.documentSymbolConcurrency,
        hoverConcurrency: server.hoverConcurrency,
        requestCacheMaxEntries: server.requestCacheMaxEntries,
        providerVersion: server.version,
        adaptiveDocScope: server.adaptiveDocScope,
        adaptiveDegradedHint: preflightState === 'degraded' || workspaceRouting.state === 'degraded',
        adaptiveReasonHint: workspaceRouting.reasonCode || preflightReasonCode,
        ...(Array.isArray(server.hoverSymbolKinds) && server.hoverSymbolKinds.length
          ? { hoverSymbolKinds: server.hoverSymbolKinds }
          : {}),
        initializationOptions: server.initializationOptions,
        captureDiagnostics: shouldCaptureDiagnosticsForRequestedKinds(requestedKinds)
      }));
    }
    const result = mergeLspWorkspacePartitionResults(partitionResults, workspaceRouting.workspaceModel);
    let diagnosticsByChunkUid = result.diagnosticsByChunkUid;
    let diagnosticsCount = result.diagnosticsCount;
    const resultChecks = [
      ...workspaceRouting.checks,
      ...(Array.isArray(result.checks) ? result.checks.slice() : [])
    ];
    if (skippedBlockedPartitions.length > 0) {
      const sample = skippedBlockedPartitions
        .map((entry) => String(entry?.rootRel || '.'))
        .filter(Boolean)
        .slice(0, 4)
        .join(', ');
      const suffix = skippedBlockedPartitions.length > 4 ? ` (+${skippedBlockedPartitions.length - 4} more)` : '';
      resultChecks.push({
        name: `${providerId}_workspace_partition_blocked`,
        status: 'warn',
        message: `${providerId} skipped ${skippedBlockedPartitions.length} blocked workspace partition(s) (${sample}${suffix}).`
      });
    }
    invalidateProbeCacheOnInitializeFailure({
      checks: resultChecks,
      providerId: server.id || providerId,
      command: resolvedCmd,
      args: resolvedArgs,
      toolingConfig: ctx?.toolingConfig || null
    });
    if (server.rustSuppressProcMacroDiagnostics) {
      const suppression = applyRustProcMacroSuppression(diagnosticsByChunkUid);
      diagnosticsByChunkUid = suppression.diagnosticsByChunkUid;
      diagnosticsCount = suppression.diagnosticsCount;
      if (suppression.suppressedCount > 0) {
        resultChecks.push({
          name: 'tooling_rust_proc_macro_diagnostics_suppressed',
          status: 'info',
          message: `suppressed ${suppression.suppressedCount} non-fatal rust proc-macro diagnostic(s).`,
          count: suppression.suppressedCount
        });
      }
    }
    const diagnostics = appendDiagnosticChecks(
      {
        ...(diagnosticsCount
          ? { diagnosticsCount, diagnosticsByChunkUid }
          : {}),
        workspaceModel: workspaceRouting.workspaceModel
      },
      [...preChecks, ...resultChecks]
    );
    return {
      provider: { id: providerId, version: provider.version, configHash: provider.getConfigHash(ctx) },
      byChunkUid: result.byChunkUid,
      diagnostics: result.runtime
        ? { ...(diagnostics || {}), runtime: result.runtime }
        : diagnostics
    };
  };
  const runCommandProfilePreflight = (ctx) => {
    return resolveCommandProfilePreflightResult({
      providerId: server.id || providerId,
      requestedCommand: {
        cmd: server.cmd,
        args: server.args || []
      },
      ctx,
      unavailableCheck: {
        ...buildCommandUnavailableCheck(server.cmd)
      }
    });
  };

  const provider = {
    id: providerId,
    label: server.label || `LSP ${server.id}`,
    version: server.version || '1.0.0',
    priority: Number.isFinite(server.priority) ? server.priority : 80,
    languages: server.languages || [],
    kinds: Array.isArray(server.kinds) && server.kinds.length
      ? server.kinds.slice()
      : ['types', 'diagnostics'],
    capabilities: {
      supportsVirtualDocuments: true,
      supportsSegmentRouting: true,
      supportsJavaScript: true,
      supportsTypeScript: true,
      supportsSymbolRef: false
    },
    requires: {
      cmd: server.cmd
    },
    getConfigHash(ctx) {
      return hashProviderConfig({ server, lsp: ctx?.toolingConfig?.lsp || {} });
    },
    async run(ctx, inputs) {
      const log = typeof ctx?.logger === 'function' ? ctx.logger : (() => {});
      const preChecks = [];
      let requestedCommand = {
        cmd: server.cmd,
        args: server.args || []
      };
      if (ctx?.toolingConfig?.lsp?.enabled === false) {
        return {
          provider: { id: providerId, version: this.version, configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, preChecks)
        };
      }
      const docs = Array.isArray(inputs?.documents) ? inputs.documents : [];
      const targets = Array.isArray(inputs?.targets) ? inputs.targets : [];
      const captureDiagnostics = shouldCaptureDiagnosticsForRequestedKinds(inputs?.kinds);
      const startupDocs = resolveLspStartupDocuments({
        providerId,
        documents: docs,
        captureDiagnostics,
        targets
      }).documents;
      const startupDocPaths = new Set(
        startupDocs.map((doc) => String(doc?.virtualPath || '')).filter(Boolean)
      );
      const startupTargets = startupDocPaths.size > 0
        ? targets.filter((target) => startupDocPaths.has(String(target?.virtualPath || '')))
        : [];
      if (!startupDocs.length || !startupTargets.length) {
        return {
          provider: { id: providerId, version: this.version, configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, preChecks)
        };
      }
      let commandProfile = null;
      let preflightState = 'ready';
      let preflightReasonCode = null;
      let blockedWorkspaceKeys = [];
      let blockedWorkspaceRoots = [];
      if (typeof this.preflight === 'function') {
        const preflight = await awaitToolingProviderPreflight(ctx, {
          provider: this,
          inputs: {
            ...inputs,
            documents: startupDocs,
            targets: startupTargets,
            log
          },
          waveToken: typeof inputs?.toolingPreflightWaveToken === 'string'
            ? inputs.toolingPreflightWaveToken
            : null
        });
        if (preflight?.check && typeof preflight.check === 'object') {
          preChecks.push(preflight.check);
        }
        if (Array.isArray(preflight?.checks)) {
          for (const check of preflight.checks) {
            if (check && typeof check === 'object') preChecks.push(check);
          }
        }
        if (preflight?.blockProvider === true || preflight?.blockSourcekit === true) {
          return {
            provider: { id: providerId, version: this.version, configHash: this.getConfigHash(ctx) },
            byChunkUid: {},
            diagnostics: appendDiagnosticChecks(null, preChecks)
          };
        }
        if (preflight?.requestedCommand && typeof preflight.requestedCommand === 'object') {
          requestedCommand = preflight.requestedCommand;
        }
        if (preflight?.commandProfile && typeof preflight.commandProfile === 'object') {
          commandProfile = preflight.commandProfile;
        }
        preflightState = String(preflight?.state || 'ready');
        preflightReasonCode = preflight?.reasonCode || null;
        blockedWorkspaceKeys = Array.isArray(preflight?.blockedWorkspaceKeys) ? preflight.blockedWorkspaceKeys : [];
        blockedWorkspaceRoots = Array.isArray(preflight?.blockedWorkspaceRoots) ? preflight.blockedWorkspaceRoots : [];
      }
      const runtimeCommand = resolveRuntimeCommandFromPreflight({
        preflight: {
          requestedCommand,
          commandProfile
        },
        fallbackRequestedCommand: requestedCommand,
        missingProfileCheck: {
          name: 'lsp_preflight_command_profile_missing',
          status: 'warn',
          message: `configured LSP preflight did not provide a resolved command for ${providerId}; skipping provider.`
        }
      });
      if (!runtimeCommand.cmd) {
        preChecks.push({
          ...runtimeCommand.checks[0]
        });
        return {
          provider: { id: providerId, version: this.version, configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, preChecks)
        };
      }
      if (runtimeCommand.probeKnown && runtimeCommand.probeOk !== true) {
        if (!preChecks.some((entry) => entry?.name === 'lsp_command_unavailable')) {
          preChecks.push(buildCommandUnavailableCheck(server.cmd));
        }
        log('[index] configured LSP command probe failed; attempting stdio initialization.');
      }
      return await collectConfiguredOutput({
        ctx,
        provider: this,
        docs: startupDocs,
        targets: startupTargets,
        requestedKinds: inputs?.kinds,
        log,
        preChecks,
        commandProfile: runtimeCommand.commandProfile,
        requestedCommand: runtimeCommand.requestedCommand,
        preflightState,
        preflightReasonCode,
        blockedWorkspaceKeys,
        blockedWorkspaceRoots
      });
    },
    preparePreflightInputs(ctx, inputs) {
      const documents = Array.isArray(inputs?.documents) ? inputs.documents : [];
      const startupSelection = resolveLspStartupDocuments({
        providerId,
        documents,
        captureDiagnostics: shouldCaptureDiagnosticsForRequestedKinds(inputs?.kinds),
        targets: Array.isArray(inputs?.targets) ? inputs.targets : []
      });
      const startupDocuments = startupSelection.documents;
      const startupDocPaths = new Set(
        startupDocuments.map((doc) => String(doc?.virtualPath || '')).filter(Boolean)
      );
      return {
        documents: startupDocuments,
        targets: Array.isArray(inputs?.targets)
          ? inputs.targets.filter((target) => {
            const path = String(target?.virtualPath || '');
            return startupDocPaths.has(path);
          })
          : []
      };
    }
  };
  provider.preflightId = server.workspaceMarkerOptions && server.requireWorkspaceModel !== false
    ? `${providerId}.workspace-model`
    : `${providerId}.command-profile`;
  provider.preflightPolicy = server.preflightPolicy;
  provider.preflightRuntimeRequirements = server.preflightRuntimeRequirements;
  provider.preflightTimeoutMs = Number.isFinite(server.preflightTimeoutMs)
    ? Math.max(500, Math.floor(server.preflightTimeoutMs))
    : null;
  provider.preflightClass = server.preflightClass
    || (server.workspaceMarkerOptions && server.requireWorkspaceModel !== false ? 'workspace' : 'probe');
  provider.preflight = async (ctx, inputs = {}) => {
    const preflightAbortSignal = inputs?.abortSignal || inputs?.managerAbortSignal || null;
    const commandPreflight = runCommandProfilePreflight(ctx);
    const luaLibraryPreflight = resolveLuaWorkspaceLibraryPreflight({
      server,
      repoRoot: ctx?.repoRoot || process.cwd()
    });
    const yamlSchemaModePreflight = resolveYamlSchemaModePreflight({ server });
    const runtimeRequirementPreflight = resolveRuntimeRequirementsPreflight({
      ctx,
      providerId,
      requirements: server.preflightRuntimeRequirements
    });
    const zigWorkspaceRootPreflight = resolveZigWorkspaceRootPreflight({
      server,
      repoRoot: ctx?.repoRoot || process.cwd()
    });
    const rustSuppressionPolicyPreflight = resolveRustProcMacroSuppressionPolicyPreflight({
      server
    });
    if (commandPreflight.state !== 'ready') {
      const checks = mergePreflightChecks(
        commandPreflight?.checks,
        luaLibraryPreflight?.check,
        luaLibraryPreflight?.checks,
        yamlSchemaModePreflight?.check,
        yamlSchemaModePreflight?.checks,
        runtimeRequirementPreflight?.check,
        runtimeRequirementPreflight?.checks,
        rustSuppressionPolicyPreflight?.check,
        rustSuppressionPolicyPreflight?.checks,
        zigWorkspaceRootPreflight?.check,
        zigWorkspaceRootPreflight?.checks
      );
      return {
        ...commandPreflight,
        ...(checks.length ? { checks } : {})
      };
    }
    const [
      luaWorkspaceConfigPreflight,
      goWorkspacePreflight,
      rustWorkspacePreflight
    ] = await Promise.all([
      resolveLuaWorkspaceConfigPreflight({
        server,
        repoRoot: ctx?.repoRoot || process.cwd()
      }),
      resolveGoWorkspaceModulePreflight({
        ctx,
        server,
        abortSignal: preflightAbortSignal,
        documents: Array.isArray(inputs?.documents) ? inputs.documents : []
      }),
      resolveRustWorkspaceMetadataPreflight({
        ctx,
        server,
        abortSignal: preflightAbortSignal,
        documents: Array.isArray(inputs?.documents) ? inputs.documents : []
      })
    ]);
    if (!(server.workspaceMarkerOptions && server.requireWorkspaceModel !== false)) {
      const checks = mergePreflightChecks(
        luaLibraryPreflight?.check,
        luaLibraryPreflight?.checks,
        luaWorkspaceConfigPreflight?.check,
        luaWorkspaceConfigPreflight?.checks,
        yamlSchemaModePreflight?.check,
        yamlSchemaModePreflight?.checks,
        runtimeRequirementPreflight?.check,
        runtimeRequirementPreflight?.checks,
        rustSuppressionPolicyPreflight?.check,
        rustSuppressionPolicyPreflight?.checks,
        zigWorkspaceRootPreflight?.check,
        zigWorkspaceRootPreflight?.checks,
        goWorkspacePreflight?.check,
        goWorkspacePreflight?.checks,
        rustWorkspacePreflight?.check,
        rustWorkspacePreflight?.checks
      );
      const environmentPreflight = resolveFirstNonReadyPreflight(
        luaLibraryPreflight,
        luaWorkspaceConfigPreflight,
        yamlSchemaModePreflight,
        runtimeRequirementPreflight,
        rustSuppressionPolicyPreflight,
        zigWorkspaceRootPreflight,
        goWorkspacePreflight,
        rustWorkspacePreflight
      );
      if (environmentPreflight.state !== 'ready') {
        return {
          ...commandPreflight,
          state: environmentPreflight.state || 'degraded',
          reasonCode: environmentPreflight.reasonCode || null,
          message: environmentPreflight.message || '',
          cached: environmentPreflight.cached === true,
          ...(environmentPreflight?.blockProvider === true ? { blockProvider: true } : {}),
          ...(Array.isArray(environmentPreflight?.blockedWorkspaceKeys)
            ? { blockedWorkspaceKeys: environmentPreflight.blockedWorkspaceKeys.slice() }
            : {}),
          ...(Array.isArray(environmentPreflight?.blockedWorkspaceRoots)
            ? { blockedWorkspaceRoots: environmentPreflight.blockedWorkspaceRoots.slice() }
            : {}),
          ...(checks.length ? { checks } : {})
        };
      }
      return {
        ...commandPreflight,
        cached: environmentPreflight.cached === true,
        ...(checks.length ? { checks } : {})
      };
    }
    const workspacePreflight = resolveWorkspaceModelPreflight({
      repoRoot: ctx?.repoRoot || process.cwd(),
      markerOptions: server.workspaceMarkerOptions || {},
      candidatePaths: Array.isArray(inputs?.documents)
        ? inputs.documents.map((doc) => doc?.virtualPath || doc?.path || '').filter(Boolean)
        : [],
      missingCheck: {
        name: `${server.id}_workspace_model_missing`,
        message: server.workspaceModelMissingMessage
      },
      fallbackName: `${server.id}_workspace_model_missing`,
      fallbackMessage: server.workspaceModelMissingMessage,
      policy: server.workspaceModelPolicy
    });
    const checks = mergePreflightChecks(
      workspacePreflight?.check,
      workspacePreflight?.checks,
      luaLibraryPreflight?.check,
      luaLibraryPreflight?.checks,
      luaWorkspaceConfigPreflight?.check,
      luaWorkspaceConfigPreflight?.checks,
      yamlSchemaModePreflight?.check,
      yamlSchemaModePreflight?.checks,
      runtimeRequirementPreflight?.check,
      runtimeRequirementPreflight?.checks,
      rustSuppressionPolicyPreflight?.check,
      rustSuppressionPolicyPreflight?.checks,
      zigWorkspaceRootPreflight?.check,
      zigWorkspaceRootPreflight?.checks,
      goWorkspacePreflight?.check,
      goWorkspacePreflight?.checks,
      rustWorkspacePreflight?.check,
      rustWorkspacePreflight?.checks
    );
    if (workspacePreflight.blockProvider === true || workspacePreflight.blockSourcekit === true) {
      return {
        state: 'blocked',
        reasonCode: workspacePreflight.reasonCode || commandPreflight.reasonCode || 'preflight_unknown',
        message: workspacePreflight.message || commandPreflight.message || '',
        blockProvider: true,
        commandProfile: commandPreflight.commandProfile,
        ...(checks.length ? { checks } : {})
      };
    }
    const environmentPreflight = resolveFirstNonReadyPreflight(
      luaLibraryPreflight,
      luaWorkspaceConfigPreflight,
      yamlSchemaModePreflight,
      runtimeRequirementPreflight,
      rustSuppressionPolicyPreflight,
      zigWorkspaceRootPreflight,
      goWorkspacePreflight,
      rustWorkspacePreflight
    );
    if (environmentPreflight.state !== 'ready') {
      return {
        ...commandPreflight,
        state: environmentPreflight.state || 'degraded',
        reasonCode: environmentPreflight.reasonCode || null,
        message: environmentPreflight.message || '',
        cached: environmentPreflight.cached === true,
        ...(environmentPreflight?.blockProvider === true ? { blockProvider: true } : {}),
        ...(Array.isArray(environmentPreflight?.blockedWorkspaceKeys)
          ? { blockedWorkspaceKeys: environmentPreflight.blockedWorkspaceKeys.slice() }
          : {}),
        ...(Array.isArray(environmentPreflight?.blockedWorkspaceRoots)
          ? { blockedWorkspaceRoots: environmentPreflight.blockedWorkspaceRoots.slice() }
          : {}),
        ...(checks.length ? { checks } : {})
      };
    }
    return {
      state: workspacePreflight.state || 'ready',
      reasonCode: workspacePreflight.reasonCode || commandPreflight.reasonCode || null,
      message: workspacePreflight.message || commandPreflight.message || '',
      cached: environmentPreflight.cached === true,
      commandProfile: commandPreflight.commandProfile,
      ...(checks.length ? { checks } : {})
    };
  };
  return provider;
};

export const createConfiguredLspProviders = (toolingConfig) => {
  const lsp = toolingConfig?.lsp || null;
  if (!lsp || lsp.enabled === false) return [];
  const servers = Array.isArray(lsp.servers) ? lsp.servers : [];
  const providers = [];
  const normalizedServers = [];
  const configuredServerIds = new Set();
  for (let i = 0; i < servers.length; i += 1) {
    const normalized = normalizeServerConfig(servers[i], i);
    if (!normalized) continue;
    configuredServerIds.add(normalized.id);
    normalizedServers.push(normalized);
  }
  const autoServers = collectAutoPresetServers(toolingConfig, configuredServerIds);
  for (let i = 0; i < autoServers.length; i += 1) {
    const normalized = normalizeServerConfig(autoServers[i], servers.length + i);
    if (!normalized) continue;
    normalizedServers.push(normalized);
  }
  for (const server of normalizedServers) {
    providers.push(createConfiguredLspProvider(server));
  }
  return providers;
};
