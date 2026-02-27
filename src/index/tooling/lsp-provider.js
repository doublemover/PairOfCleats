import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { appendDiagnosticChecks, hashProviderConfig, normalizeProviderId } from './provider-contract.js';
import { resolveToolingCommandProfile } from './command-resolver.js';
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
import { hasWorkspaceMarker } from './workspace-model.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';

const normalizeList = (value) => {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return [];
};

const normalizeArgs = (value) => {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
};

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
const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

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
  const next = {};
  let diagnosticsCount = 0;
  let suppressedCount = 0;
  for (const [chunkUid, diagnostics] of Object.entries(diagnosticsByChunkUid)) {
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
  const uriScheme = merged.uriScheme === 'poc-vfs' ? 'poc-vfs' : 'file';
  const timeoutMs = Number(merged.timeoutMs);
  const documentSymbolTimeoutMs = Number(merged.documentSymbolTimeoutMs);
  const hoverTimeoutMs = Number(merged.hoverTimeoutMs);
  const signatureHelpTimeoutMs = Number(merged.signatureHelpTimeoutMs);
  const retries = Number(merged.retries);
  const priority = Number(merged.priority);
  const documentSymbolConcurrency = Number(merged.documentSymbolConcurrency);
  const hoverConcurrency = Number(merged.hoverConcurrency);
  const hoverCacheMaxEntries = Number(merged.hoverCacheMaxEntries);
  const hoverMaxPerFile = Number(merged.hoverMaxPerFile);
  const hoverDisableAfterTimeouts = Number(merged.hoverDisableAfterTimeouts);
  const hoverEnabled = typeof merged.hoverEnabled === 'boolean'
    ? merged.hoverEnabled
    : (typeof merged.hover === 'boolean' ? merged.hover : null);
  const signatureHelpEnabled = typeof merged.signatureHelpEnabled === 'boolean'
    ? merged.signatureHelpEnabled
    : (typeof merged.signatureHelp === 'boolean' ? merged.signatureHelp : null);
  const hoverRequireMissingReturn = typeof merged.hoverRequireMissingReturn === 'boolean'
    ? merged.hoverRequireMissingReturn
    : null;
  const hoverSymbolKinds = normalizeHoverSymbolKinds(merged.hoverSymbolKinds);
  const breakerThreshold = Number(merged.circuitBreakerThreshold);
  const requireWorkspaceModel = typeof merged.requireWorkspaceModel === 'boolean'
    ? merged.requireWorkspaceModel
    : null;
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
  const lifecycle = isPlainObject(merged.lifecycle)
    ? deepCloneValue(merged.lifecycle)
    : null;
  const rustSuppressProcMacroDiagnostics = id === 'rust-analyzer'
    ? merged.rustSuppressProcMacroDiagnostics !== false
    : false;
  return {
    id,
    providerId,
    cmd,
    args,
    languages,
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
    hoverCacheMaxEntries: Number.isFinite(hoverCacheMaxEntries)
      ? Math.max(1000, Math.floor(hoverCacheMaxEntries))
      : null,
    hoverMaxPerFile: Number.isFinite(hoverMaxPerFile)
      ? Math.max(0, Math.floor(hoverMaxPerFile))
      : null,
    hoverDisableAfterTimeouts: Number.isFinite(hoverDisableAfterTimeouts)
      ? Math.max(1, Math.floor(hoverDisableAfterTimeouts))
      : null,
    hoverEnabled,
    signatureHelpEnabled,
    hoverRequireMissingReturn,
    hoverSymbolKinds,
    rustSuppressProcMacroDiagnostics,
    requireWorkspaceModel,
    lifecycle,
    lifecycleRestartWindowMs: merged.lifecycleRestartWindowMs,
    lifecycleMaxRestartsPerWindow: merged.lifecycleMaxRestartsPerWindow,
    lifecycleFdPressureBackoffMs: merged.lifecycleFdPressureBackoffMs,
    initializationOptions,
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
  return {
    id: providerId,
    label: server.label || `LSP ${server.id}`,
    version: server.version || '1.0.0',
    priority: Number.isFinite(server.priority) ? server.priority : 80,
    languages: server.languages || [],
    kinds: ['types', 'diagnostics'],
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
      if (ctx?.toolingConfig?.lsp?.enabled === false) {
        return {
          provider: { id: providerId, version: this.version, configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, preChecks)
        };
      }
      const docs = Array.isArray(inputs?.documents) ? inputs.documents : [];
      const targets = Array.isArray(inputs?.targets) ? inputs.targets : [];
      if (!docs.length || !targets.length) {
        return {
          provider: { id: providerId, version: this.version, configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, preChecks)
        };
      }
      if (server.id === 'gopls' && server.requireWorkspaceModel !== false) {
        const markerFound = hasWorkspaceMarker(ctx?.repoRoot || process.cwd(), {
          exactNames: ['go.mod', 'go.work']
        });
        if (!markerFound) {
          preChecks.push({
            name: 'gopls_workspace_model_missing',
            status: 'warn',
            message: 'gopls workspace markers (go.mod/go.work) not found near repo root.'
          });
        }
      }
      const commandProfile = resolveToolingCommandProfile({
        providerId: server.id || providerId,
        cmd: server.cmd,
        args: server.args || [],
        repoRoot: ctx?.repoRoot || process.cwd(),
        toolingConfig: ctx?.toolingConfig || {}
      });
      if (!commandProfile.probe.ok) {
        return {
          provider: { id: providerId, version: this.version, configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, [
            ...preChecks,
            {
              name: 'lsp_command_unavailable',
              status: 'warn',
              message: `${server.cmd} command not available for ${providerId}.`
            }
          ])
        };
      }
      const result = await collectLspTypes({
        ...resolveLspRuntimeConfig({
          providerConfig: server,
          globalConfigs: [ctx?.toolingConfig?.lsp || null, ctx?.toolingConfig || null],
          defaults: {
            timeoutMs: 15000,
            retries: 2,
            breakerThreshold: 3
          }
        }),
        rootDir: ctx.repoRoot,
        documents: docs,
        targets,
        abortSignal: ctx?.abortSignal || null,
        log,
        providerId,
        cmd: commandProfile.resolved.cmd,
        args: commandProfile.resolved.args || [],
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
        hoverCacheMaxEntries: server.hoverCacheMaxEntries,
        ...(Array.isArray(server.hoverSymbolKinds) && server.hoverSymbolKinds.length
          ? { hoverSymbolKinds: server.hoverSymbolKinds }
          : {}),
        initializationOptions: server.initializationOptions,
        captureDiagnostics: true
      });
      let diagnosticsByChunkUid = result.diagnosticsByChunkUid;
      let diagnosticsCount = result.diagnosticsCount;
      const resultChecks = Array.isArray(result.checks) ? result.checks.slice() : [];
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
        diagnosticsCount
          ? { diagnosticsCount, diagnosticsByChunkUid }
          : null,
        [...preChecks, ...resultChecks]
      );
      return {
        provider: { id: providerId, version: this.version, configHash: this.getConfigHash(ctx) },
        byChunkUid: result.byChunkUid,
        diagnostics: result.runtime
          ? { ...(diagnostics || {}), runtime: result.runtime }
          : diagnostics
      };
    }
  };
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
