import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { hashProviderConfig, normalizeProviderId } from './provider-contract.js';
import { parseClikeSignature } from './signature-parse/clike.js';
import { parsePythonSignature } from './signature-parse/python.js';
import { parseSwiftSignature } from './signature-parse/swift.js';

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

const normalizeServerId = (value, fallback) => {
  const base = normalizeProviderId(value || fallback || 'lsp');
  const safe = base.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return safe || 'lsp';
};

const normalizeLanguageList = (value) => normalizeList(value).map((entry) => entry.toLowerCase());

const parseGenericSignature = (detail, languageId, symbolName) => {
  const lang = String(languageId || '').toLowerCase();
  if (lang === 'python' || lang === 'py' || lang === 'pyi') return parsePythonSignature(detail);
  if (lang === 'swift') return parseSwiftSignature(detail);
  if ([
    'c', 'cpp', 'objective-c', 'objective-cpp',
    'java', 'kotlin', 'csharp',
    'javascript', 'jsx', 'typescript', 'tsx',
    'go', 'rust', 'php'
  ].includes(lang)) {
    return parseClikeSignature(detail, symbolName);
  }
  return parseClikeSignature(detail, symbolName)
    || parsePythonSignature(detail)
    || parseSwiftSignature(detail);
};

const normalizeServerConfig = (server, index) => {
  if (!server || typeof server !== 'object') return null;
  const id = normalizeServerId(server.id, `lsp-${index + 1}`);
  const cmd = String(server.cmd || '').trim();
  if (!cmd) return null;
  const args = normalizeArgs(server.args);
  const languages = normalizeLanguageList(server.languages);
  const uriScheme = server.uriScheme === 'poc-vfs' ? 'poc-vfs' : 'file';
  const timeoutMs = Number(server.timeoutMs);
  const retries = Number(server.retries);
  const priority = Number(server.priority);
  return {
    id,
    cmd,
    args,
    languages,
    uriScheme,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.max(1000, Math.floor(timeoutMs)) : null,
    retries: Number.isFinite(retries) ? Math.max(0, Math.floor(retries)) : null,
    priority: Number.isFinite(priority) ? priority : null,
    label: typeof server.label === 'string' ? server.label : null,
    version: typeof server.version === 'string' ? server.version : null
  };
};

const createConfiguredLspProvider = (server) => {
  const providerId = `lsp-${server.id}`;
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
      if (ctx?.toolingConfig?.lsp?.enabled === false) {
        return { provider: { id: providerId, version: this.version, configHash: this.getConfigHash(ctx) }, byChunkUid: {} };
      }
      const docs = Array.isArray(inputs?.documents) ? inputs.documents : [];
      const targets = Array.isArray(inputs?.targets) ? inputs.targets : [];
      if (!docs.length || !targets.length) {
        return { provider: { id: providerId, version: this.version, configHash: this.getConfigHash(ctx) }, byChunkUid: {} };
      }
      const result = await collectLspTypes({
        rootDir: ctx.repoRoot,
        documents: docs,
        targets,
        log,
        cmd: server.cmd,
        args: server.args || [],
        timeoutMs: server.timeoutMs || ctx?.toolingConfig?.timeoutMs || 15000,
        retries: server.retries ?? ctx?.toolingConfig?.maxRetries ?? 2,
        breakerThreshold: ctx?.toolingConfig?.circuitBreakerThreshold ?? 3,
        parseSignature: parseGenericSignature,
        strict: ctx?.strict !== false,
        vfsRoot: ctx?.buildRoot || ctx.repoRoot,
        uriScheme: server.uriScheme || 'file',
        vfsTokenMode: ctx?.toolingConfig?.vfs?.tokenMode,
        vfsIoBatching: ctx?.toolingConfig?.vfs?.ioBatching,
        vfsColdStartCache: ctx?.toolingConfig?.vfs?.coldStartCache,
        indexDir: ctx?.buildRoot || null,
        captureDiagnostics: true
      });
      return {
        provider: { id: providerId, version: this.version, configHash: this.getConfigHash(ctx) },
        byChunkUid: result.byChunkUid,
        diagnostics: result.diagnosticsCount
          ? { diagnosticsCount: result.diagnosticsCount, diagnosticsByChunkUid: result.diagnosticsByChunkUid }
          : null
      };
    }
  };
};

export const createConfiguredLspProviders = (toolingConfig) => {
  const lsp = toolingConfig?.lsp || null;
  if (!lsp || lsp.enabled === false) return [];
  const servers = Array.isArray(lsp.servers) ? lsp.servers : [];
  const providers = [];
  for (let i = 0; i < servers.length; i += 1) {
    const normalized = normalizeServerConfig(servers[i], i);
    if (!normalized) continue;
    providers.push(createConfiguredLspProvider(normalized));
  }
  return providers;
};
