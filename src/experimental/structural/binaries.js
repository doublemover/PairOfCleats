import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const isWindows = process.platform === 'win32';
const binaryCache = new Map();

const quoteCmdArg = (value) => {
  const text = String(value);
  if (!/[\\s&|^()<>]/.test(text) && !text.includes('"')) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
};

const buildCmdLine = (command, args) => [
  quoteCmdArg(command),
  ...args.map(quoteCmdArg)
].join(' ');

const runCommand = (resolved, args, options = {}) => {
  const command = resolved?.command || resolved;
  const argsPrefix = resolved?.argsPrefix || [];
  const effectiveArgs = [...argsPrefix, ...args];
  if (isWindows && /\.(cmd|bat)$/i.test(command)) {
    const cmdLine = buildCmdLine(command, effectiveArgs);
    return spawnSync('cmd.exe', ['/d', '/s', '/c', cmdLine], { ...options, shell: false });
  }
  return spawnSync(command, effectiveArgs, { ...options, shell: false });
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
    const result = runCommand(candidate, ['--version'], { encoding: 'utf8' });
    if (!result.error && result.status === 0) {
      const output = { command: candidate, argsPrefix: [], checkedPaths: [] };
      binaryCache.set(engine, { pathEnv, value: output });
      return output;
    }
    const help = runCommand(candidate, ['--help'], { encoding: 'utf8' });
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
