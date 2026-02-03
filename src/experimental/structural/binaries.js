import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const isWindows = process.platform === 'win32';
const binaryCache = new Map();

const quoteCmdArg = (value) => {
  const text = String(value);
  // If the argument contains no spaces, special cmd.exe metacharacters, or quotes,
  // we can safely return it as-is.
  if (!/[\\s&|^()<>]/.test(text) && !text.includes('"')) return text;

  // Windows cmd.exe/C runtime style quoting:
  // - Wrap the argument in double quotes.
  // - Double internal quotes.
  // - Carefully handle sequences of backslashes before quotes and at the end.
  let quoted = '"';
  let backslashes = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      // Escape all accumulated backslashes, then escape the quote.
      quoted += '\\'.repeat(backslashes * 2 + 1);
      quoted += '"';
      backslashes = 0;
      continue;
    }
    // Normal character: keep accumulated backslashes, then the character.
    if (backslashes > 0) {
      quoted += '\\'.repeat(backslashes);
      backslashes = 0;
    }
    quoted += ch;
  }
  // At the end, any remaining backslashes must be doubled to ensure the
  // closing quote is not escaped.
  if (backslashes > 0) {
    quoted += '\\'.repeat(backslashes * 2);
  }
  quoted += '"';
  return quoted;
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
