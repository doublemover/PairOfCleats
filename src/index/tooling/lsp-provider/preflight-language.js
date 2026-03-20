import fsSync from 'node:fs';
import path from 'node:path';
import { readJsonFileSafe } from '../../../shared/files.js';
import {
  LUA_WORKSPACE_CONFIG_MAX_BYTES,
  normalizeLuaWorkspaceLibraryEntries,
  resolveLuaWorkspaceLibraryPath
} from './normalize.js';

export const resolveLuaWorkspaceLibraryPreflight = ({ server, repoRoot }) => {
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

export const resolveLuaWorkspaceConfigPreflight = async ({ server, repoRoot }) => {
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

export const resolveYamlSchemaModePreflight = ({ server }) => {
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

export const resolveZigWorkspaceRootPreflight = ({ server, repoRoot }) => {
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

export const resolveRustProcMacroSuppressionPolicyPreflight = ({ server }) => {
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

export const resolveFirstNonReadyPreflight = (...entries) => {
  let cachedReady = null;
  for (const entry of entries) {
    const state = String(entry?.state || 'ready').trim().toLowerCase() || 'ready';
    if (state !== 'ready') return entry;
    if (!cachedReady && entry?.cached === true) cachedReady = entry;
  }
  return cachedReady || { state: 'ready', reasonCode: null, message: '' };
};
