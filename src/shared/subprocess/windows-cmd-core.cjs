const fs = require('node:fs');
const path = require('node:path');

const WINDOWS_CMD_META_PATTERN = /[\s"%!&|<>^();]/u;

function unwrapWrapperPrefix(line) {
  return String(line || '')
    .replace(/^@/u, '')
    .replace(/^endlocal\s+&\s+goto\b[\s\S]*?\|\|\s+title\s+%COMSPEC%\s+&\s*/iu, '')
    .trim();
}

function tokenizeCmdLine(line) {
  const tokens = [];
  const pattern = /"((?:[^"]|"")*)"|(\S+)/gu;
  let match = null;
  while ((match = pattern.exec(String(line || ''))) !== null) {
    tokens.push(match[1] != null ? match[1].replaceAll('""', '"') : match[2]);
  }
  return tokens;
}

function resolveWrapperNodeProgram(wrapperDir) {
  const localNode = path.join(wrapperDir, 'node.exe');
  if (fs.existsSync(localNode)) return localNode;
  return process.execPath || 'node';
}

function normalizeWrapperToken(token, { wrapperDir, nodeProgram }) {
  const wrapperPrefix = wrapperDir.endsWith(path.sep) ? wrapperDir : `${wrapperDir}${path.sep}`;
  return String(token || '')
    .replace(/%~dp0/giu, wrapperPrefix)
    .replace(/%dp0%/giu, wrapperPrefix)
    .replace(/%_prog%/giu, nodeProgram);
}

function splitPathEntries(envPath) {
  return String(envPath || '')
    .split(path.delimiter)
    .map((entry) => entry && entry.trim())
    .filter(Boolean);
}

function resolveCommandPath(cmd) {
  const raw = String(cmd || '').trim();
  if (!raw) return '';
  if (path.isAbsolute(raw)) return fs.existsSync(raw) ? raw : '';
  if (/[\\/]/u.test(raw)) {
    const candidate = path.resolve(raw);
    return fs.existsSync(candidate) ? candidate : '';
  }
  for (const dir of splitPathEntries(process.env.PATH || process.env.Path || process.env.path || '')) {
    const candidate = path.join(dir, raw);
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function maybeResolveWindowsCmdShim(cmdPath, args = []) {
  if (!cmdPath || !/\.(cmd|bat)$/iu.test(String(cmdPath || ''))) return null;
  if (!fs.existsSync(cmdPath) || !fs.statSync(cmdPath).isFile()) return null;
  let raw = '';
  try {
    raw = fs.readFileSync(cmdPath, 'utf8');
  } catch {
    return null;
  }
  const wrapperDir = path.dirname(path.resolve(cmdPath));
  const nodeProgram = resolveWrapperNodeProgram(wrapperDir);
  const lines = raw
    .split(/\r?\n/u)
    .map((line) => unwrapWrapperPrefix(line))
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!/(?:^|\s)(?:node|php|python|ruby|java|dotnet|"%_prog%"|%_prog%)/iu.test(line)) continue;
    const forwardsArgs = /%\*/u.test(line);
    const tokens = tokenizeCmdLine(line)
      .map((token) => normalizeWrapperToken(token, { wrapperDir, nodeProgram }))
      .filter((token) => token && token !== '%*');
    if (tokens.length < 2) continue;
    const [commandToken, ...fixedArgs] = tokens;
    const resolvedCommand = commandToken === 'node' ? nodeProgram : commandToken;
    return {
      command: resolvedCommand,
      args: forwardsArgs ? [...fixedArgs, ...(Array.isArray(args) ? args : [])] : fixedArgs
    };
  }
  return null;
}

function quoteWindowsCmdArg(value) {
  const text = String(value ?? '');
  if (!text) return '""';
  const escaped = text
    .replaceAll('^', '^^')
    .replaceAll('%', '^%')
    .replaceAll('!', '^!')
    .replaceAll('&', '^&')
    .replaceAll('|', '^|')
    .replaceAll('<', '^<')
    .replaceAll('>', '^>')
    .replaceAll('(', '^(')
    .replaceAll(')', '^)')
    .replaceAll(';', '^;')
    .replaceAll('"', '""');
  if (!WINDOWS_CMD_META_PATTERN.test(text)) return escaped;
  return `"${escaped}"`;
}

function buildWindowsShellCommand(cmd, args = []) {
  return [cmd, ...(Array.isArray(args) ? args : [])]
    .map(quoteWindowsCmdArg)
    .join(' ');
}

function createUnresolvedWrapperError(cmd) {
  const error = new Error(`Unsafe Windows wrapper invocation requires an explicit executable or a parseable shim: ${cmd}`);
  error.code = 'ERR_WINDOWS_CMD_UNSAFE_WRAPPER';
  return error;
}

function resolveWindowsCmdInvocation(cmd, args = []) {
  const raw = String(cmd || '').trim();
  if (!/\.(cmd|bat)$/iu.test(raw)) {
    return { command: cmd, args: Array.isArray(args) ? [...args] : [] };
  }
  const resolvedPath = resolveCommandPath(raw);
  if (!resolvedPath) {
    const error = new Error(`Windows wrapper command not found: ${cmd}`);
    error.code = 'ERR_WINDOWS_CMD_NOT_FOUND';
    throw error;
  }
  const shimInvocation = maybeResolveWindowsCmdShim(resolvedPath, args);
  if (shimInvocation) return shimInvocation;
  throw createUnresolvedWrapperError(resolvedPath);
}

module.exports = {
  quoteWindowsCmdArg,
  buildWindowsShellCommand,
  resolveWindowsCmdInvocation
};
