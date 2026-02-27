import fsSync from 'node:fs';
import path from 'node:path';
import { execaSync } from 'execa';
import { resolveToolRoot } from '../../shared/dict-utils.js';
import { isAbsolutePathNative } from '../../shared/files.js';
import { createLspClient, pathToFileUri } from '../../integrations/tooling/lsp/client.js';
import { findBinaryInDirs, findBinaryOnPath, splitPathEntries } from './binary-utils.js';
import { normalizeProviderId } from './provider-contract.js';

const WINDOWS_EXEC_EXTS = ['.exe', '.cmd', '.bat'];
const DEFAULT_PROBE_ARGS = [['--version'], ['--help']];
const COMMAND_PROBE_CACHE = new Map();
const COMMAND_PROBE_CACHE_MAX_ENTRIES = 256;
const COMMAND_PROBE_FAILURE_TTL_MS = 10_000;

const shouldUseShell = (cmd) => process.platform === 'win32' && /\.(cmd|bat)$/i.test(String(cmd || ''));

const quoteWindowsCmdArg = (value) => {
  const text = String(value ?? '');
  if (!text) return '""';
  if (!/[\s"&|<>^();]/u.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
};

const runProbeCommand = (cmd, args = [], options = {}) => {
  if (!shouldUseShell(cmd)) {
    return execaSync(cmd, args, {
      reject: false,
      stdio: 'pipe',
      encoding: 'utf8',
      maxBuffer: options.maxBuffer || (2 * 1024 * 1024)
    });
  }
  const commandLine = [cmd, ...(Array.isArray(args) ? args : [])]
    .map(quoteWindowsCmdArg)
    .join(' ');
  const shellExe = process.env.ComSpec || 'cmd.exe';
  return execaSync(shellExe, ['/d', '/s', '/c', commandLine], {
    reject: false,
    stdio: 'pipe',
    encoding: 'utf8',
    maxBuffer: options.maxBuffer || (2 * 1024 * 1024)
  });
};

const summarizeProbeText = (value, maxChars = 400) => {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
};

const setBoundedCacheEntry = (map, key, value, maxEntries) => {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey == null) break;
    map.delete(oldestKey);
  }
};

const resolveWindowsCommand = (cmd) => {
  if (process.platform !== 'win32') return cmd;
  const lowered = String(cmd || '').toLowerCase();
  if (WINDOWS_EXEC_EXTS.some((ext) => lowered.endsWith(ext))) return cmd;
  const pathEntries = splitPathEntries(process.env.PATH || '');
  for (const ext of WINDOWS_EXEC_EXTS) {
    for (const dir of pathEntries) {
      const candidate = path.join(dir, `${cmd}${ext}`);
      if (fsSync.existsSync(candidate)) return candidate;
    }
  }
  return cmd;
};

const hasPathSeparator = (value) => /[\\/]/u.test(String(value || ''));

const normalizeCommandToken = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const base = path.basename(raw).trim().toLowerCase();
  return base.endsWith('.exe') ? base.slice(0, -4) : base;
};

const resolvePyrightCommand = (repoRoot, toolingConfig) => {
  const cmd = 'pyright-langserver';
  const toolRoot = resolveToolRoot();
  const repoBin = path.join(repoRoot, 'node_modules', '.bin');
  const toolBin = toolRoot ? path.join(toolRoot, 'node_modules', '.bin') : null;
  const toolingBin = toolingConfig?.dir
    ? path.join(toolingConfig.dir, 'node', 'node_modules', '.bin')
    : null;
  const found = findBinaryInDirs(cmd, [repoBin, toolBin, toolingBin].filter(Boolean));
  if (found) return found;
  return findBinaryOnPath(cmd) || cmd;
};

const resolveGoToolCommand = (cmd, toolingConfig) => {
  const toolingBin = toolingConfig?.dir
    ? path.join(toolingConfig.dir, 'bin')
    : null;
  if (toolingBin) {
    const found = findBinaryInDirs(cmd, [toolingBin]);
    if (found) return found;
  }
  return findBinaryOnPath(cmd) || cmd;
};

const resolveScopedCommand = ({ cmd, repoRoot, toolingConfig }) => {
  const requested = String(cmd || '').trim();
  if (!requested) return '';
  if (isAbsolutePathNative(requested) || hasPathSeparator(requested)) return requested;
  const repoBin = path.join(repoRoot, 'node_modules', '.bin');
  const toolBin = toolingConfig?.dir
    ? path.join(toolingConfig.dir, 'bin')
    : null;
  const toolingNodeBin = toolingConfig?.dir
    ? path.join(toolingConfig.dir, 'node', 'node_modules', '.bin')
    : null;
  const scopedMatch = findBinaryInDirs(requested, [repoBin, toolBin, toolingNodeBin].filter(Boolean));
  if (scopedMatch) return scopedMatch;
  return resolveWindowsCommand(findBinaryOnPath(requested) || requested);
};

const getProbeArgCandidates = (providerId, requestedCmd) => {
  const cmdName = normalizeCommandToken(requestedCmd);
  if (providerId === 'gopls' || cmdName === 'gopls') {
    return [['version'], ['help'], ['--help']];
  }
  if (providerId === 'jdtls' || cmdName === 'jdtls') {
    return [['-version'], ['--version'], ['-help'], ['--help']];
  }
  if (providerId === 'elixir-ls' || cmdName === 'elixir-ls' || cmdName.includes('elixir-ls')) {
    return [['--version'], ['-version'], ['--help']];
  }
  if (providerId === 'haskell-language-server' || cmdName === 'haskell-language-server') {
    return [['--version'], ['version'], ['--help']];
  }
  if (providerId === 'sourcekit' || cmdName.includes('sourcekit')) {
    return [['--help'], ['--version']];
  }
  if (providerId === 'pyright' || cmdName.includes('pyright-langserver')) {
    return [['--version'], ['--help']];
  }
  return DEFAULT_PROBE_ARGS;
};

const resolveBaseCommand = ({ providerId, requestedCmd, repoRoot, toolingConfig }) => {
  const normalizedProviderId = normalizeProviderId(providerId);
  const normalizedRequested = String(requestedCmd || '').trim();
  const requestedToken = normalizeCommandToken(normalizedRequested);
  if (normalizedProviderId === 'pyright') {
    if (!normalizedRequested || requestedToken === 'pyright-langserver') {
      return resolvePyrightCommand(repoRoot, toolingConfig);
    }
    return resolveScopedCommand({
      cmd: normalizedRequested,
      repoRoot,
      toolingConfig
    });
  }
  if (normalizedProviderId === 'gopls') {
    if (!normalizedRequested || requestedToken === 'gopls') {
      return resolveGoToolCommand('gopls', toolingConfig);
    }
    return resolveScopedCommand({
      cmd: normalizedRequested,
      repoRoot,
      toolingConfig
    });
  }
  if (normalizedProviderId === 'clangd') {
    return resolveScopedCommand({
      cmd: requestedCmd || 'clangd',
      repoRoot,
      toolingConfig
    });
  }
  if (normalizedProviderId === 'sourcekit' || requestedCmd === 'sourcekit-lsp') {
    return resolveScopedCommand({
      cmd: requestedCmd || 'sourcekit-lsp',
      repoRoot,
      toolingConfig
    });
  }
  if (requestedCmd) {
    return resolveScopedCommand({
      cmd: requestedCmd,
      repoRoot,
      toolingConfig
    });
  }
  return '';
};

const probeBinary = ({ command, probeArgs }) => {
  const cacheKey = `${String(command || '').trim()}\u0000${JSON.stringify(probeArgs || [])}`;
  const now = Date.now();
  const cached = COMMAND_PROBE_CACHE.get(cacheKey) || null;
  if (cached && now <= Number(cached.expiresAt || 0)) {
    return {
      ok: cached.ok === true,
      attempted: Array.isArray(cached.attempted) ? cached.attempted : [],
      cached: true
    };
  }
  if (cached) {
    COMMAND_PROBE_CACHE.delete(cacheKey);
  }
  const attempted = [];
  for (const args of probeArgs) {
    try {
      const result = runProbeCommand(command, args);
      attempted.push({
        args,
        exitCode: result.exitCode ?? null,
        stderr: summarizeProbeText(result.stderr),
        stdout: summarizeProbeText(result.stdout)
      });
      if (result.exitCode === 0) {
        setBoundedCacheEntry(
          COMMAND_PROBE_CACHE,
          cacheKey,
          {
            ok: true,
            attempted,
            expiresAt: Number.POSITIVE_INFINITY
          },
          COMMAND_PROBE_CACHE_MAX_ENTRIES
        );
        return {
          ok: true,
          attempted,
          cached: false
        };
      }
    } catch (err) {
      attempted.push({
        args,
        exitCode: null,
        stderr: summarizeProbeText(err?.stderr || err?.shortMessage || err?.message || err),
        stdout: summarizeProbeText(err?.stdout || ''),
        errorCode: err?.code || null
      });
    }
  }
  setBoundedCacheEntry(
    COMMAND_PROBE_CACHE,
    cacheKey,
    {
      ok: false,
      attempted,
      expiresAt: now + COMMAND_PROBE_FAILURE_TTL_MS
    },
    COMMAND_PROBE_CACHE_MAX_ENTRIES
  );
  return {
    ok: false,
    attempted,
    cached: false
  };
};

export const __resetToolingCommandProbeCacheForTests = () => {
  COMMAND_PROBE_CACHE.clear();
};

export const __getToolingCommandProbeCacheStatsForTests = () => ({
  commandProbeEntries: COMMAND_PROBE_CACHE.size
});

/**
 * Resolve command path + launch args for tooling providers using profile rules.
 *
 * @param {{
 *   providerId?:string,
 *   cmd:string,
 *   args?:string[],
 *   repoRoot?:string,
 *   toolingConfig?:object
 * }} input
 * @returns {{
 *   providerId:string,
 *   requested:{cmd:string,args:string[]},
 *   resolved:{cmd:string,args:string[],mode:string,reason:string},
 *   probe:{ok:boolean,attempted:Array<object>}
 * }}
 */
export const resolveToolingCommandProfile = (input) => {
  const providerId = normalizeProviderId(input?.providerId || input?.cmd || 'tooling');
  const requestedCmd = String(input?.cmd || '').trim();
  const requestedArgs = Array.isArray(input?.args)
    ? input.args.map((entry) => String(entry))
    : [];
  const repoRoot = input?.repoRoot || process.cwd();
  const toolingConfig = input?.toolingConfig || {};
  const resolvedCmd = resolveBaseCommand({
    providerId,
    requestedCmd,
    repoRoot,
    toolingConfig
  });
  const probeArgs = getProbeArgCandidates(providerId, requestedCmd || resolvedCmd);
  const probe = probeBinary({
    command: resolvedCmd || requestedCmd,
    probeArgs
  });

  const resolved = {
    cmd: resolvedCmd || requestedCmd,
    args: requestedArgs,
    mode: 'direct',
    reason: 'default-direct-launch'
  };

  if (providerId === 'gopls' && probe.ok) {
    if (!requestedArgs.length) {
      resolved.mode = 'gopls-direct';
      resolved.reason = 'direct-default';
    } else {
      resolved.mode = 'gopls-explicit-args';
      resolved.reason = 'explicit-args-preserved';
    }
  } else if (providerId === 'gopls' && !requestedArgs.length) {
    resolved.mode = 'gopls-direct';
    resolved.reason = 'probe-failed-direct';
  }

  return {
    providerId,
    requested: {
      cmd: requestedCmd,
      args: requestedArgs
    },
    resolved,
    probe
  };
};

/**
 * Perform bounded initialize/shutdown handshake probe for an LSP command.
 * Returns machine-readable diagnostics for doctor reports.
 *
 * @param {{
 *   cmd:string,
 *   args?:string[],
 *   cwd?:string,
 *   timeoutMs?:number
 * }} input
 * @returns {Promise<{ok:boolean,latencyMs:number,errorCode:string|null,errorMessage:string|null}>}
 */
export const probeLspInitializeHandshake = async (input) => {
  const cmd = String(input?.cmd || '').trim();
  if (!cmd) {
    return {
      ok: false,
      latencyMs: 0,
      errorCode: 'MISSING_CMD',
      errorMessage: 'missing command'
    };
  }
  const args = Array.isArray(input?.args) ? input.args.map((entry) => String(entry)) : [];
  const cwd = input?.cwd || process.cwd();
  const timeoutMs = Number.isFinite(Number(input?.timeoutMs))
    ? Math.max(750, Math.floor(Number(input.timeoutMs)))
    : 4000;
  const client = createLspClient({
    cmd,
    args,
    cwd,
    log: () => {}
  });
  const startedAt = Date.now();
  try {
    await client.initialize({
      rootUri: pathToFileUri(cwd),
      capabilities: { textDocument: { documentSymbol: {} } },
      timeoutMs
    });
    await client.shutdownAndExit();
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      errorCode: null,
      errorMessage: null
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      errorCode: err?.code || null,
      errorMessage: summarizeProbeText(err?.message || err, 240) || 'initialize handshake failed'
    };
  } finally {
    client.kill();
  }
};
