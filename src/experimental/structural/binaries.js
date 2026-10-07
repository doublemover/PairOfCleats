import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWindowsCmdInvocation } from '../../shared/subprocess/windows-cmd.js';
import {
  DEFAULT_SYNC_COMMAND_TIMEOUT_MS,
  runSyncCommandWithTimeout
} from '../../shared/subprocess/sync-command.js';

const isWindows = process.platform === 'win32';
const binaryCache = new Map();

const resolveWindowsStructuralInvocation = (command, args, options) => {
  const env = options.env || process.env;
  const cwd = options.cwd instanceof URL ? fileURLToPath(options.cwd) : String(options.cwd || process.cwd());
  const localCommand = path.resolve(cwd, command);
  // cmd.exe used the child cwd for explicit relative paths and searched it
  // before PATH for bare wrapper names. Preserve that lookup before quoting.
  if (path.isAbsolute(command) || /[\\/]/u.test(command) || /^[a-z]:/iu.test(command) || fsExists(localCommand)) {
    return resolveWindowsCmdInvocation(localCommand, args, env);
  }
  const pathEnv = env.PATH || env.Path || env.path || '';
  const resolutionEnv = {
    ...env,
    PATH: pathEnv.split(path.delimiter)
      .filter((entry) => entry.trim())
      .map((entry) => path.resolve(cwd, entry.trim()))
      .join(path.delimiter)
  };
  return resolveWindowsCmdInvocation(command, args, resolutionEnv);
};

const runCommand = (resolved, args, options = {}) => {
  const command = resolved?.command || resolved;
  const argsPrefix = resolved?.argsPrefix || [];
  const effectiveArgs = [...argsPrefix, ...args];
  const hasExplicitEncoding = Object.prototype.hasOwnProperty.call(options, 'encoding');
  const encoding = hasExplicitEncoding ? options.encoding : 'utf8';
  const timeoutMs = Object.prototype.hasOwnProperty.call(options, 'timeoutMs')
    ? (Number.isFinite(Number(options?.timeoutMs))
      ? Math.max(100, Math.floor(Number(options.timeoutMs)))
      : null)
    : null;
  if (isWindows && /\.(cmd|bat)$/i.test(command)) {
    let invocation;
    try {
      // Prefer direct argv for recognizable shims. Opaque wrappers must use the
      // shared cmd transport, including line-break rejection and %* escaping.
      invocation = resolveWindowsStructuralInvocation(command, effectiveArgs, options);
    } catch (error) {
      return { pid: null, status: null, signal: null, stdout: '', stderr: '', error };
    }
    return runSyncCommandWithTimeout(invocation.command, invocation.args, {
      ...options,
      encoding,
      timeoutMs,
      shell: false,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments === true
    });
  }
  return runSyncCommandWithTimeout(command, effectiveArgs, {
    ...options,
    encoding,
    timeoutMs,
    shell: false
  });
};

const findOnPath = (candidate) => {
  const pathEnv = process.env.PATH || '';
  const paths = pathEnv.split(path.delimiter).filter(Boolean);
  const ext = path.extname(candidate);
  const names = ext
    ? [candidate]
    : [
      candidate,
      `${candidate}.exe`,
      `${candidate}.cmd`,
      `${candidate}.bat`,
      `${candidate}.ps1`
    ];
  const checked = [];
  for (const dir of paths) {
    for (const name of names) {
      const fullPath = path.join(dir, name);
      checked.push(fullPath);
      if (fsExists(fullPath)) return { path: fullPath, checked };
    }
  }
  return { path: null, checked };
};

const fsExists = (target) => {
  try {
    if (!target) return false;
    const resolved = path.resolve(target);
    const stat = fs.statSync(resolved);
    return stat.isFile();
  } catch {
    return false;
  }
};

const resolvePowerShell = () => {
  const pwsh = findOnPath('pwsh');
  if (pwsh.path) return pwsh.path;
  const powershell = findOnPath('powershell');
  if (powershell.path) return powershell.path;
  return 'powershell';
};

export const resolveBinary = (engine) => {
  const pathEnv = process.env.PATH || '';
  const cached = binaryCache.get(engine);
  if (cached && cached.pathEnv === pathEnv) return cached.value;
  const candidates = {
    semgrep: ['semgrep'],
    'ast-grep': ['sg', 'ast-grep'],
    comby: ['comby']
  }[engine] || [];
  if (isWindows) {
    let checkedPaths = [];
    for (const candidate of candidates) {
      const resolved = findOnPath(candidate);
      checkedPaths = checkedPaths.concat(resolved.checked || []);
      if (!resolved.path) continue;
      const ext = path.extname(resolved.path).toLowerCase();
      if (ext === '.ps1') {
        const shell = resolvePowerShell();
        const output = {
          command: shell,
          argsPrefix: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolved.path],
          checkedPaths
        };
        binaryCache.set(engine, { pathEnv, value: output });
        return output;
      }
      if (!ext || ['.js', '.mjs', '.cjs'].includes(ext)) {
        const output = { command: process.execPath, argsPrefix: [resolved.path], checkedPaths };
        binaryCache.set(engine, { pathEnv, value: output });
        return output;
      }
      const output = { command: resolved.path, argsPrefix: [], checkedPaths };
      binaryCache.set(engine, { pathEnv, value: output });
      return output;
    }
    const output = { command: candidates[0] || engine, argsPrefix: [], checkedPaths };
    binaryCache.set(engine, { pathEnv, value: output });
    return output;
  }
  for (const candidate of candidates) {
    const result = runCommand(candidate, ['--version'], {
      encoding: 'utf8',
      timeoutMs: DEFAULT_SYNC_COMMAND_TIMEOUT_MS
    });
    if (!result.error && result.status === 0) {
      const output = { command: candidate, argsPrefix: [], checkedPaths: [] };
      binaryCache.set(engine, { pathEnv, value: output });
      return output;
    }
    const help = runCommand(candidate, ['--help'], {
      encoding: 'utf8',
      timeoutMs: DEFAULT_SYNC_COMMAND_TIMEOUT_MS
    });
    if (!help.error && help.status === 0) {
      const output = { command: candidate, argsPrefix: [], checkedPaths: [] };
      binaryCache.set(engine, { pathEnv, value: output });
      return output;
    }
  }
  const output = { command: candidates[0] || engine, argsPrefix: [], checkedPaths: [] };
  binaryCache.set(engine, { pathEnv, value: output });
  return output;
};

export const runBinary = (resolved, args, options = {}) => runCommand(resolved, args, options);
