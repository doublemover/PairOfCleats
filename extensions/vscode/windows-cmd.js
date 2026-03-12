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

function maybeResolveWindowsCmdShim(cmd, args = []) {
  if (!cmd || !/\.(cmd|bat)$/iu.test(String(cmd || ''))) return null;
  if (!fs.existsSync(cmd) || !fs.statSync(cmd).isFile()) return null;
  let raw = '';
  try {
    raw = fs.readFileSync(cmd, 'utf8');
  } catch {
    return null;
  }
  const wrapperDir = path.dirname(path.resolve(cmd));
  const nodeProgram = resolveWrapperNodeProgram(wrapperDir);
  const lines = raw
    .split(/\r?\n/u)
    .map((line) => unwrapWrapperPrefix(line))
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!/%\*/u.test(line)) continue;
    if (!/(?:^|\s)(?:node|php|python|ruby|java|dotnet|"%_prog%"|%_prog%)/iu.test(line)) continue;
    const tokens = tokenizeCmdLine(line)
      .map((token) => normalizeWrapperToken(token, { wrapperDir, nodeProgram }))
      .filter((token) => token && token !== '%*');
    if (tokens.length < 2) continue;
    const [commandToken, ...fixedArgs] = tokens;
    const resolvedCommand = commandToken === 'node' ? nodeProgram : commandToken;
    return {
      command: resolvedCommand,
      args: [...fixedArgs, ...(Array.isArray(args) ? args : [])]
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

function resolveWindowsCmdInvocation(cmd, args = []) {
  const shimInvocation = maybeResolveWindowsCmdShim(cmd, args);
  if (shimInvocation) return shimInvocation;
  const shellExe = process.env.ComSpec || 'cmd.exe';
  return {
    command: shellExe,
    args: ['/d', '/s', '/c', buildWindowsShellCommand(cmd, args)]
  };
}

module.exports = {
  quoteWindowsCmdArg,
  buildWindowsShellCommand,
  resolveWindowsCmdInvocation
};
