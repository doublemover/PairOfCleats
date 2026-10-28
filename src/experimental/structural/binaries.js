import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getToolingConfig } from '../../shared/dict-utils.js';
import { detectTool, resolveToolsById } from '../../../tools/tooling/utils.js';
import { identifyProvisioningExecutable } from '../../../tools/tooling/provisioning-plan.js';
import { resolveWindowsCmdInvocation } from '../../shared/subprocess/windows-cmd.js';
import {
  DEFAULT_SYNC_COMMAND_TIMEOUT_MS,
  runSyncCommandWithTimeout
} from '../../shared/subprocess/sync-command.js';

const isWindows = process.platform === 'win32';

const resolveWindowsStructuralInvocation = (command, args, options) => {
  const env = options.env || process.env;
  const cwd = options.cwd instanceof URL ? fileURLToPath(options.cwd) : String(options.cwd || process.cwd());
  const localCommand = path.resolve(cwd, command);
  // cmd.exe used the child cwd for explicit relative paths and searched it
  // before PATH for bare wrapper names. Preserve that lookup before quoting.
  if (path.isAbsolute(command) || /[\\/]/u.test(command) || /^[a-z]:/iu.test(command) || fsExists(localCommand)) {
    return resolveWindowsCmdInvocation(localCommand, args, env, { cwd });
  }
  return resolveWindowsCmdInvocation(command, args, env, { cwd });
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

export const verifyStructuralBinaryIdentity = (engine, result) => {
  if (result?.error || result?.status !== 0) return false;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (engine === 'ast-grep') return /^ast-grep\s+\d+\.\d+\.\d+\b/m.test(output);
  if (engine === 'semgrep') return /^(?:semgrep\s+)?\d+\.\d+\.\d+\b/i.test(output);
  if (engine === 'comby') return /^(?:comby\s+)?\d+\.\d+\.\d+\b/i.test(output);
  return false;
};

export const resolveBinary = (engine, { repoRoot = null } = {}) => {
  if (repoRoot) {
    const config = getToolingConfig(repoRoot);
    const tool = resolveToolsById([engine], config.dir, repoRoot, config)[0];
    if (tool?.managedInstallation) return { command: tool.managedInstallation.command,
      argsPrefix: tool.managedInstallation.args || [], checkedPaths: [tool.managedInstallation.command],
      requiresOwnedExecution: true, toolingRoot: config.dir, managedInstallation: tool.managedInstallation };
    const status = tool ? detectTool(tool) : null;
    if (!status?.found || !status.path) return { command: engine, argsPrefix: [], checkedPaths: [], unavailable: true };
    const command = path.isAbsolute(status.path) ? status.path : findOnPath(status.path).path;
    if (!command) return { command: engine, argsPrefix: [], checkedPaths: [], unavailable: true };
    const output = { command, argsPrefix: tool.managedInstallation?.args || [], checkedPaths: [command] };
    if (!verifyStructuralBinaryIdentity(engine, runCommand(output, [engine === 'comby' ? '-version' : '--version'], { timeoutMs: DEFAULT_SYNC_COMMAND_TIMEOUT_MS }))) return { ...output, unavailable: true };
    return { ...output, executableIdentity: identifyProvisioningExecutable(command) };
  }
  const candidates = {
    semgrep: ['semgrep'],
    'ast-grep': ['ast-grep', 'sg'],
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
        if (verifyStructuralBinaryIdentity(engine, runCommand(output, ['--version'], { timeoutMs: DEFAULT_SYNC_COMMAND_TIMEOUT_MS }))) return output;
        continue;
      }
      if (!ext || ['.js', '.mjs', '.cjs'].includes(ext)) {
        const output = { command: process.execPath, argsPrefix: [resolved.path], checkedPaths };
        if (verifyStructuralBinaryIdentity(engine, runCommand(output, ['--version'], { timeoutMs: DEFAULT_SYNC_COMMAND_TIMEOUT_MS }))) return output;
        continue;
      }
      const output = { command: resolved.path, argsPrefix: [], checkedPaths };
      if (verifyStructuralBinaryIdentity(engine, runCommand(output, [engine === 'comby' ? '-version' : '--version'], { timeoutMs: DEFAULT_SYNC_COMMAND_TIMEOUT_MS }))) return output;
    }
    const output = { command: candidates[0] || engine, argsPrefix: [], checkedPaths, unavailable: true };
    return output;
  }
  for (const candidate of candidates) {
    const result = runCommand(candidate, [engine === 'comby' ? '-version' : '--version'], {
      encoding: 'utf8',
      timeoutMs: DEFAULT_SYNC_COMMAND_TIMEOUT_MS
    });
    if (verifyStructuralBinaryIdentity(engine, result)) {
      const output = { command: candidate, argsPrefix: [], checkedPaths: [] };
      return output;
    }
    const help = runCommand(candidate, ['--help'], {
      encoding: 'utf8',
      timeoutMs: DEFAULT_SYNC_COMMAND_TIMEOUT_MS
    });
    if (verifyStructuralBinaryIdentity(engine, help)) {
      const output = { command: candidate, argsPrefix: [], checkedPaths: [] };
      return output;
    }
  }
  const output = { command: candidates[0] || engine, argsPrefix: [], checkedPaths: [], unavailable: true };
  return output;
};

export const runBinary = (resolved, args, options = {}) => {
  if (resolved?.requiresOwnedExecution) throw Object.assign(new Error('Managed structural execution requires its retained async runtime scope.'), { code: 'ERR_STRUCTURAL_OWNER_REQUIRED' });
  if (resolved?.unavailable) return { status: null, signal: null, stdout: '', stderr: '', error: Object.assign(new Error('No identified structural engine executable is available.'), { code: 'ENOENT' }) };
  if (resolved.executableIdentity && identifyProvisioningExecutable(resolved.command).sha256 !== resolved.executableIdentity.sha256) throw new Error('Structural engine bytes changed after selection; resolve again.');
  return runCommand(resolved, args, options);
};
