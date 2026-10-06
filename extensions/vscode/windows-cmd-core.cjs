const fs = require('node:fs');
const path = require('node:path');

const WINDOWS_CMD_META_PATTERN = /[()\][%!^"`<>&|;, *?\t]/u;
const WINDOWS_CMD_META_ESCAPE_PATTERN = /[()\][%!^"`<>&|;, *?\t]/gu;
const WRAPPER_LAUNCH_PATTERN = /^(?:node|php|python|ruby|java|dotnet|"%_prog%"|%_prog%)(?:\s|$)/iu;

function assertSafeShellText(text) {
  if (!/[\0\r\n]/u.test(text)) return;
  const error = new Error('Windows command shell text cannot contain NUL or line breaks.');
  error.code = 'ERR_WINDOWS_CMD_UNSAFE_ARGUMENT';
  throw error;
}

function escapeWindowsCmdMeta(text) {
  return text.replace(WINDOWS_CMD_META_ESCAPE_PATTERN, '^$&');
}

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

function resolveCommandPath(cmd, env = process.env) {
  const raw = String(cmd || '').trim();
  if (!raw) return '';
  if (path.isAbsolute(raw)) return fs.existsSync(raw) ? raw : '';
  if (/[\\/]/u.test(raw)) {
    const candidate = path.resolve(raw);
    return fs.existsSync(candidate) ? candidate : '';
  }
  const envPath = env?.PATH || env?.Path || env?.path || '';
  for (const dir of splitPathEntries(envPath)) {
    const candidate = path.join(dir, raw);
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function resolveWindowsCmdShimPath(cmd, env = process.env) {
  const raw = String(cmd || '').trim();
  if (!raw) return '';
  const ext = path.extname(raw).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    return resolveCommandPath(raw, env);
  }
  if (ext) return '';

  if (path.isAbsolute(raw) || /[\\/]/u.test(raw)) {
    for (const candidateExt of ['.cmd', '.bat']) {
      const candidate = `${raw}${candidateExt}`;
      if (fs.existsSync(candidate)) return candidate;
    }
    return '';
  }

  for (const candidateExt of ['.cmd', '.bat']) {
    const resolved = resolveCommandPath(`${raw}${candidateExt}`, env);
    if (resolved) return resolved;
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
  // Only bypass cmd.exe for a straight-line wrapper. Extracting the last
  // invocation from an IF/GOTO script would discard its probe/launch branches.
  const launchLines = lines.filter((line) => WRAPPER_LAUNCH_PATTERN.test(line));
  if (launchLines.length !== 1 || lines.some((line) => (
    !WRAPPER_LAUNCH_PATTERN.test(line)
    && !/^(?:echo\s+off|setlocal|endlocal|rem(?:\s.*)?|::.*)$/iu.test(line)
  )) || /[&|<>]/u.test(launchLines[0])) return null;
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

function quoteWindowsCmdArg(value, { doubleEscape = false } = {}) {
  const text = String(value ?? '');
  assertSafeShellText(text);
  if (text && !WINDOWS_CMD_META_PATTERN.test(text)) return text;
  // First quote for the eventual executable's Windows argv parser. Backslashes
  // are doubled only before a quote (including the final closing quote).
  const needsQuotes = !text || /\s/u.test(text);
  let quoted = needsQuotes ? '"' : '';
  let backslashes = 0;
  for (const character of text) {
    if (character === '\\') {
      backslashes += 1;
      continue;
    }
    quoted += '\\'.repeat(character === '"' ? backslashes * 2 + 1 : backslashes);
    quoted += character;
    backslashes = 0;
  }
  quoted += needsQuotes ? `${'\\'.repeat(backslashes * 2)}"` : '\\'.repeat(backslashes);
  if (needsQuotes && !/[%!^"&|<>]/u.test(text)) return quoted;
  // Escape the quote syntax too: carets *inside* protective quotes are literal.
  // A batch forwarder (%*) parses the text again, requiring one more layer.
  const escaped = escapeWindowsCmdMeta(quoted);
  return doubleEscape ? escapeWindowsCmdMeta(escaped) : escaped;
}

function buildWindowsShellCommand(cmd, args = [], { doubleEscape = false } = {}) {
  const command = String(cmd ?? '');
  assertSafeShellText(command);
  return [escapeWindowsCmdMeta(command), ...(Array.isArray(args) ? args : [])
    .map((value) => quoteWindowsCmdArg(value, { doubleEscape }))]
    .join(' ');
}

function resolveWindowsCommandProcessor() {
  const explicit = String(process.env.ComSpec || process.env.COMSPEC || '').trim();
  if (explicit) return explicit;
  const systemRoot = String(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows').trim() || 'C:\\Windows';
  return path.join(systemRoot, 'System32', 'cmd.exe');
}

function buildWindowsCmdShellInvocation(cmdPath, args = []) {
  // A recognized native launch with trailing, unquoted %* parses argv again.
  // Comments, SET/ECHO text, quoted %*, CALL and positional forwarding are not
  // evidence of this protocol. General nested batch protocols remain opaque.
  const doubleEscape = fs.readFileSync(cmdPath, 'utf8')
    .split(/\r?\n/u)
    .map(unwrapWrapperPrefix)
    .some((line) => WRAPPER_LAUNCH_PATTERN.test(line) && /(?:^|\s)%\*\s*$/u.test(line));
  return {
    command: resolveWindowsCommandProcessor(),
    args: ['/d', '/s', '/c', `"${buildWindowsShellCommand(cmdPath, args, { doubleEscape })}"`],
    windowsVerbatimArguments: true
  };
}

function resolveWindowsCmdInvocation(cmd, args = [], env = process.env) {
  const raw = String(cmd || '').trim();
  const resolvedShimPath = resolveWindowsCmdShimPath(raw, env);
  if (!resolvedShimPath && /\.(cmd|bat)$/iu.test(raw)) {
    const error = new Error(`Windows wrapper command not found: ${cmd}`);
    error.code = 'ERR_WINDOWS_CMD_NOT_FOUND';
    throw error;
  }
  if (!resolvedShimPath) {
    return { command: cmd, args: Array.isArray(args) ? [...args] : [] };
  }
  const shimInvocation = maybeResolveWindowsCmdShim(resolvedShimPath, args);
  if (shimInvocation) return shimInvocation;
  return buildWindowsCmdShellInvocation(resolvedShimPath, args);
}

module.exports = {
  quoteWindowsCmdArg,
  buildWindowsShellCommand,
  buildWindowsCmdShellInvocation,
  resolveWindowsCmdShimPath,
  resolveWindowsCmdInvocation
};
