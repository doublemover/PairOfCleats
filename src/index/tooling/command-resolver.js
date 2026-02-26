import fsSync from 'node:fs';
import path from 'node:path';
import { execaSync } from 'execa';
import { resolveToolRoot } from '../../shared/dict-utils.js';
import { isAbsolutePathNative } from '../../shared/files.js';
import { createLspClient, pathToFileUri } from '../../integrations/tooling/lsp/client.js';
import { findBinaryInDirs, findBinaryOnPath } from './binary-utils.js';
import { normalizeProviderId } from './provider-contract.js';

const WINDOWS_EXEC_EXTS = ['.exe', '.cmd', '.bat'];
const DEFAULT_PROBE_ARGS = [['--version'], ['--help']];

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

const resolveWindowsCommand = (cmd) => {
  if (process.platform !== 'win32') return cmd;
  const lowered = String(cmd || '').toLowerCase();
  if (WINDOWS_EXEC_EXTS.some((ext) => lowered.endsWith(ext))) return cmd;
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const ext of WINDOWS_EXEC_EXTS) {
    for (const dir of pathEntries) {
      const candidate = path.join(dir, `${cmd}${ext}`);
      if (fsSync.existsSync(candidate)) return candidate;
    }
  }
  return cmd;
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

const getProbeArgCandidates = (providerId, requestedCmd) => {
  const cmdName = String(requestedCmd || '').toLowerCase();
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
  if (normalizedProviderId === 'pyright' || requestedCmd === 'pyright-langserver') {
    return resolvePyrightCommand(repoRoot, toolingConfig);
  }
  if (normalizedProviderId === 'gopls' || requestedCmd === 'gopls') {
    return resolveGoToolCommand('gopls', toolingConfig);
  }
  if (normalizedProviderId === 'clangd') {
    return resolveWindowsCommand(requestedCmd || 'clangd');
  }
  if (normalizedProviderId === 'sourcekit' || requestedCmd === 'sourcekit-lsp') {
    return resolveWindowsCommand(requestedCmd || 'sourcekit-lsp');
  }
  if (requestedCmd) {
    if (isAbsolutePathNative(requestedCmd) || requestedCmd.includes(path.sep)) return requestedCmd;
    return resolveWindowsCommand(findBinaryOnPath(requestedCmd) || requestedCmd);
  }
  return '';
};

const probeBinary = ({ command, probeArgs }) => {
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
        return {
          ok: true,
          attempted
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
  return {
    ok: false,
    attempted
  };
};

const probeGoplsServeSupport = (command) => {
  try {
    const result = runProbeCommand(command, ['help', 'serve']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
};

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
    const serveSupported = probeGoplsServeSupport(resolved.cmd);
    if (!requestedArgs.length && serveSupported) {
      resolved.args = ['serve'];
      resolved.mode = 'gopls-serve';
      resolved.reason = 'serve-supported-and-no-explicit-args';
    } else if (!requestedArgs.length) {
      resolved.mode = 'gopls-direct';
      resolved.reason = 'serve-not-supported';
    } else {
      resolved.mode = 'gopls-explicit-args';
      resolved.reason = 'explicit-args-preserved';
    }
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
