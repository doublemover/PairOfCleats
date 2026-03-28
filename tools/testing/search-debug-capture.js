import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { stripAnsi } from '../../src/shared/cli/ansi-utils.js';
import * as nodePty from 'node-pty';
import {
  reconstructTerminalScreen,
  summarizeRenderedTerminal
} from './terminal-screen.js';

const DEFAULT_TERM = 'xterm-256color';
const DEFAULT_LOG_DIR_NAME = 'search-debug';
const DEFAULT_TERMINAL_REVIEW_LOG_DIR_NAME = 'search-terminal-review';
const MAX_LABEL_LENGTH = 48;
const MAX_SUFFIX_LENGTH = 24;

const toSafeLabel = (value, fallback = 'search') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) return fallback;
  return normalized.slice(0, MAX_LABEL_LENGTH) || fallback;
};

const toSafeSuffix = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) return '';
  return normalized.slice(0, MAX_SUFFIX_LENGTH);
};

const deriveTerminalSizeSuffix = ({ outputSuffix = null, env = null } = {}) => {
  const explicit = toSafeSuffix(outputSuffix);
  if (explicit) return explicit;
  const source = env && typeof env === 'object' ? env : null;
  const columnsRaw = source?.COLUMNS;
  const linesRaw = source?.LINES;
  const columns = Number.parseInt(String(columnsRaw ?? ''), 10);
  const lines = Number.parseInt(String(linesRaw ?? ''), 10);
  if (!Number.isFinite(columns) || !Number.isFinite(lines) || columns <= 0 || lines <= 0) {
    return '';
  }
  return toSafeSuffix(`${columns}x${lines}`);
};

const toTimestampToken = (value = new Date()) => (
  new Date(value)
    .toISOString()
    .replace(/[:.]/g, '-')
);

const quotePowerShellArg = (value) => {
  const text = String(value ?? '');
  if (text.length <= 0) return "''";
  if (!/[\s'"]/u.test(text)) return text;
  return `'${text.replace(/'/g, "''")}'`;
};

const formatPowerShellCommand = ({ command, args = [] }) => (
  [quotePowerShellArg(command), ...args.map((arg) => quotePowerShellArg(arg))].join(' ')
);

const deriveSearchLabel = (args) => {
  for (const arg of Array.isArray(args) ? args : []) {
    const text = String(arg || '').trim();
    if (!text || text.startsWith('-')) continue;
    return toSafeLabel(text, 'search');
  }
  return 'search';
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const stripTerminalSequences = (value) => stripAnsi(String(value ?? ''))
  .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/gu, '')
  .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/gu, '');

const writeBuffer = async (filePath, chunks) => {
  const buffer = Buffer.concat(Array.isArray(chunks) ? chunks : []);
  await fs.writeFile(filePath, buffer);
  return buffer;
};

const writeText = async (filePath, value) => {
  await fs.writeFile(filePath, String(value ?? ''), 'utf8');
};

const buildCombinedLog = (events) => {
  const lines = [];
  for (const event of Array.isArray(events) ? events : []) {
    const header = `=== ${event.source} @ +${event.offsetMs}ms (${event.bytes} bytes) ===\n`;
    lines.push(header);
    lines.push(event.text);
    if (!String(event.text || '').endsWith('\n')) {
      lines.push('\n');
    }
  }
  return lines.join('');
};

const buildCommandFile = ({
  cwd,
  command,
  args,
  envOverrides
}) => {
  const envLines = Object.entries(envOverrides || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`);
  return [
    `cwd: ${cwd}`,
    `command: ${command}`,
    `shell: ${formatPowerShellCommand({ command, args })}`,
    'args:',
    ...args.map((arg, index) => `  [${index}] ${arg}`),
    'env-overrides:',
    ...(envLines.length ? envLines.map((line) => `  ${line}`) : ['  (none)']),
    ''
  ].join('\n');
};

const maybeParseJson = async (filePath, text) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return { parsed: false, error: 'empty_stdout' };
  }
  try {
    const value = JSON.parse(trimmed);
    await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
    return { parsed: true, error: null };
  } catch (error) {
    return {
      parsed: false,
      error: error?.message || String(error)
    };
  }
};

const buildSummaryText = ({
  label,
  outputDir,
  status,
  exitCode,
  signal,
  wallMs,
  files
}) => [
  `label: ${label}`,
  `status: ${status}`,
  `exitCode: ${exitCode == null ? 'null' : exitCode}`,
  `signal: ${signal || 'null'}`,
  `wallMs: ${wallMs}`,
  `outputDir: ${outputDir}`,
  `stdoutRaw: ${files.stdoutRaw}`,
  `stderrRaw: ${files.stderrRaw}`,
  `combinedRaw: ${files.combinedRaw}`,
  `eventsJsonl: ${files.eventsJsonl}`,
  `metaJson: ${files.metaJson}`,
  ''
].join('\n');

const createChunkEvent = ({
  index,
  source,
  startedAt,
  chunk
}) => {
  const buffer = Buffer.isBuffer(chunk)
    ? chunk
    : Buffer.from(String(chunk ?? ''), 'utf8');
  return {
    index,
    source,
    offsetMs: Math.max(0, Date.now() - startedAt),
    bytes: buffer.length,
    text: buffer.toString('utf8'),
    base64: buffer.toString('base64')
  };
};

export const resolveSearchDebugOutputDir = ({
  rootDir = process.cwd(),
  logsRoot = null,
  label = null,
  outputSuffix = null,
  timestamp = new Date(),
  pid = process.pid
} = {}) => {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedLogsRoot = path.resolve(
    logsRoot || path.join(resolvedRoot, '.testLogs', DEFAULT_LOG_DIR_NAME)
  );
  const labelToken = toSafeLabel(label, 'search');
  const suffixToken = toSafeSuffix(outputSuffix);
  const dirName = suffixToken
    ? `${toTimestampToken(timestamp)}-${labelToken}-${suffixToken}-${pid}`
    : `${toTimestampToken(timestamp)}-${labelToken}-${pid}`;
  return path.join(resolvedLogsRoot, dirName);
};

export const captureCommandDebugRun = async ({
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  logsRoot = null,
  label = null,
  rootDir = process.cwd(),
  forceColor = true,
  term = DEFAULT_TERM,
  spawnImpl = spawn,
  parseStdoutAsJson = true,
  trackedEnvKeys = [],
  outputSuffix = null
} = {}) => {
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('command is required');
  }
  const resolvedRoot = path.resolve(rootDir);
  const outputDir = resolveSearchDebugOutputDir({
    rootDir: resolvedRoot,
    logsRoot,
    label,
    outputSuffix: deriveTerminalSizeSuffix({ outputSuffix, env })
  });
  await ensureDir(outputDir);

  const envOverrides = {};
  const childEnv = { ...(env || {}) };
  if (forceColor) {
    if (childEnv.FORCE_COLOR !== '1') {
      childEnv.FORCE_COLOR = '1';
      envOverrides.FORCE_COLOR = '1';
    }
    if (!childEnv.TERM) {
      childEnv.TERM = term;
      envOverrides.TERM = term;
    }
    if (Object.prototype.hasOwnProperty.call(childEnv, 'NO_COLOR')) {
      delete childEnv.NO_COLOR;
      envOverrides.NO_COLOR = '(unset)';
    }
    if (Object.prototype.hasOwnProperty.call(childEnv, 'NODE_DISABLE_COLORS')) {
      delete childEnv.NODE_DISABLE_COLORS;
      envOverrides.NODE_DISABLE_COLORS = '(unset)';
    }
  }
  for (const key of Array.isArray(trackedEnvKeys) ? trackedEnvKeys : []) {
    const name = String(key || '').trim();
    if (!name) continue;
    if (Object.prototype.hasOwnProperty.call(childEnv, name)) {
      envOverrides[name] = String(childEnv[name]);
    }
  }

  const stdoutChunks = [];
  const stderrChunks = [];
  const events = [];
  const startedAt = Date.now();
  let eventIndex = 0;
  const child = spawnImpl(command, args.map((entry) => String(entry)), {
    cwd,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => {
    stdoutChunks.push(Buffer.from(chunk));
    events.push(createChunkEvent({
      index: eventIndex,
      source: 'stdout',
      startedAt,
      chunk
    }));
    eventIndex += 1;
  });
  child.stderr.on('data', (chunk) => {
    stderrChunks.push(Buffer.from(chunk));
    events.push(createChunkEvent({
      index: eventIndex,
      source: 'stderr',
      startedAt,
      chunk
    }));
    eventIndex += 1;
  });

  const childResult = await new Promise((resolve, reject) => {
    let resolved = false;
    child.once('error', (error) => {
      if (resolved) return;
      resolved = true;
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      if (resolved) return;
      resolved = true;
      resolve({
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        signal: typeof signal === 'string' && signal.trim() ? signal.trim() : null
      });
    });
  });
  const wallMs = Math.max(0, Date.now() - startedAt);

  const files = {
    stdoutRaw: path.join(outputDir, 'stdout.ansi.log'),
    stderrRaw: path.join(outputDir, 'stderr.ansi.log'),
    stdoutPlain: path.join(outputDir, 'stdout.txt'),
    stderrPlain: path.join(outputDir, 'stderr.txt'),
    combinedRaw: path.join(outputDir, 'combined.ansi.log'),
    eventsJsonl: path.join(outputDir, 'events.jsonl'),
    commandTxt: path.join(outputDir, 'command.txt'),
    summaryTxt: path.join(outputDir, 'summary.txt'),
    metaJson: path.join(outputDir, 'meta.json'),
    stdoutParsedJson: path.join(outputDir, 'stdout.parsed.json')
  };

  const stdoutBuffer = await writeBuffer(files.stdoutRaw, stdoutChunks);
  const stderrBuffer = await writeBuffer(files.stderrRaw, stderrChunks);
  const stdoutText = stdoutBuffer.toString('utf8');
  const stderrText = stderrBuffer.toString('utf8');
  await writeText(files.stdoutPlain, stdoutText ? `${stripTerminalSequences(stdoutText)}\n`.replace(/\n\n$/u, '\n') : '');
  await writeText(files.stderrPlain, stderrText ? `${stripTerminalSequences(stderrText)}\n`.replace(/\n\n$/u, '\n') : '');
  await writeText(files.combinedRaw, buildCombinedLog(events));
  await writeText(
    files.eventsJsonl,
    events.map((event) => `${JSON.stringify(event)}\n`).join('')
  );
  await writeText(files.commandTxt, buildCommandFile({
    cwd,
    command,
    args,
    envOverrides
  }));

  let stdoutJson = { parsed: false, error: null };
  if (parseStdoutAsJson) {
    stdoutJson = await maybeParseJson(files.stdoutParsedJson, stdoutText);
    if (!stdoutJson.parsed) {
      try {
        await fs.rm(files.stdoutParsedJson, { force: true });
      } catch {}
    }
  }

  const status = childResult.exitCode === 0 && !childResult.signal ? 'passed' : 'failed';
  const meta = {
    label: toSafeLabel(label, 'search'),
    mode: 'pipe',
    rootDir: resolvedRoot,
    outputDir,
    cwd,
    command,
    args,
    commandLine: formatPowerShellCommand({ command, args }),
    envOverrides,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(startedAt + wallMs).toISOString(),
    wallMs,
    status,
    exitCode: childResult.exitCode,
    signal: childResult.signal,
    files,
    stdout: {
      bytes: stdoutBuffer.length,
      parsedAsJson: stdoutJson.parsed,
      jsonParseError: stdoutJson.error
    },
    stderr: {
      bytes: stderrBuffer.length
    },
    eventCount: events.length
  };
  await writeText(files.metaJson, `${JSON.stringify(meta, null, 2)}\n`);
  await writeText(files.summaryTxt, buildSummaryText({
    label: meta.label,
    outputDir,
    status,
    exitCode: childResult.exitCode,
    signal: childResult.signal,
    wallMs,
    files
  }));

  return meta;
};

export const captureCommandTerminalRun = async ({
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  logsRoot = null,
  label = null,
  rootDir = process.cwd(),
  forceColor = true,
  term = DEFAULT_TERM,
  trackedEnvKeys = [],
  outputSuffix = null,
  cols = null,
  rows = null
} = {}) => {
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('command is required');
  }
  const resolvedRoot = path.resolve(rootDir);
  const childEnv = { ...(env || {}) };
  const envOverrides = {};
  if (forceColor) {
    if (childEnv.FORCE_COLOR !== '1') {
      childEnv.FORCE_COLOR = '1';
      envOverrides.FORCE_COLOR = '1';
    }
    if (!childEnv.TERM) {
      childEnv.TERM = term;
      envOverrides.TERM = term;
    }
    if (Object.prototype.hasOwnProperty.call(childEnv, 'NO_COLOR')) {
      delete childEnv.NO_COLOR;
      envOverrides.NO_COLOR = '(unset)';
    }
    if (Object.prototype.hasOwnProperty.call(childEnv, 'NODE_DISABLE_COLORS')) {
      delete childEnv.NODE_DISABLE_COLORS;
      envOverrides.NODE_DISABLE_COLORS = '(unset)';
    }
  }
  for (const key of Array.isArray(trackedEnvKeys) ? trackedEnvKeys : []) {
    const name = String(key || '').trim();
    if (!name) continue;
    if (Object.prototype.hasOwnProperty.call(childEnv, name)) {
      envOverrides[name] = String(childEnv[name]);
    }
  }
  const resolvedCols = cols != null && Number.isFinite(Number(cols))
    ? Number(cols)
    : Number.parseInt(String(childEnv.COLUMNS || ''), 10);
  const resolvedRows = rows != null && Number.isFinite(Number(rows))
    ? Number(rows)
    : Number.parseInt(String(childEnv.LINES || ''), 10);
  const terminalColumns = Number.isFinite(resolvedCols) && resolvedCols >= 20 ? resolvedCols : 120;
  const terminalRows = Number.isFinite(resolvedRows) && resolvedRows >= 10 ? resolvedRows : 30;
  childEnv.COLUMNS = String(terminalColumns);
  childEnv.LINES = String(terminalRows);
  envOverrides.COLUMNS = String(terminalColumns);
  envOverrides.LINES = String(terminalRows);

  const outputDir = resolveSearchDebugOutputDir({
    rootDir: resolvedRoot,
    logsRoot: logsRoot || path.join(resolvedRoot, '.testLogs', DEFAULT_TERMINAL_REVIEW_LOG_DIR_NAME),
    label,
    outputSuffix: deriveTerminalSizeSuffix({ outputSuffix, env: childEnv })
  });
  await ensureDir(outputDir);

  const startedAt = Date.now();
  const events = [];
  let eventIndex = 0;
  const chunks = [];
  const child = nodePty.spawn(command, args.map((entry) => String(entry)), {
    name: term,
    cols: terminalColumns,
    rows: terminalRows,
    cwd,
    env: childEnv
  });

  child.onData((data) => {
    const chunk = Buffer.from(String(data ?? ''), 'utf8');
    chunks.push(chunk);
    events.push(createChunkEvent({
      index: eventIndex,
      source: 'pty',
      startedAt,
      chunk
    }));
    eventIndex += 1;
  });

  const childResult = await new Promise((resolve) => {
    child.onExit((event) => {
      resolve({
        exitCode: Number.isInteger(event?.exitCode) ? event.exitCode : null,
        signal: Number.isInteger(event?.signal) ? event.signal : null
      });
    });
  });
  const wallMs = Math.max(0, Date.now() - startedAt);

  const files = {
    terminalRaw: path.join(outputDir, 'terminal.ansi.log'),
    terminalPlain: path.join(outputDir, 'terminal.txt'),
    screenTxt: path.join(outputDir, 'screen.txt'),
    screenJson: path.join(outputDir, 'screen.json'),
    eventsJsonl: path.join(outputDir, 'events.jsonl'),
    commandTxt: path.join(outputDir, 'command.txt'),
    summaryTxt: path.join(outputDir, 'summary.txt'),
    metaJson: path.join(outputDir, 'meta.json')
  };

  const terminalBuffer = await writeBuffer(files.terminalRaw, chunks);
  const terminalText = terminalBuffer.toString('utf8');
  await writeText(files.terminalPlain, terminalText ? `${stripTerminalSequences(terminalText)}\n`.replace(/\n\n$/u, '\n') : '');
  const reconstructedScreen = reconstructTerminalScreen(terminalText, {
    columns: terminalColumns,
    rows: terminalRows
  });
  await writeText(files.screenTxt, reconstructedScreen.text);
  const baseScreenSummary = summarizeRenderedTerminal(reconstructedScreen.text, {
    columns: terminalColumns
  });
  const screenSummary = {
    ...baseScreenSummary,
    overflowCount: Math.max(
      Number(baseScreenSummary.overflowCount) || 0,
      Number(reconstructedScreen.stats.wrapCount) || 0
    )
  };
  await writeText(files.screenJson, `${JSON.stringify({
    ...reconstructedScreen.stats,
    ...screenSummary
  }, null, 2)}\n`);
  await writeText(
    files.eventsJsonl,
    events.map((event) => `${JSON.stringify(event)}\n`).join('')
  );
  await writeText(files.commandTxt, buildCommandFile({
    cwd,
    command,
    args,
    envOverrides
  }));

  const status = childResult.exitCode === 0 && !childResult.signal ? 'passed' : 'failed';
  const meta = {
    label: toSafeLabel(label, 'search'),
    mode: 'pty',
    rootDir: resolvedRoot,
    outputDir,
    cwd,
    command,
    args,
    commandLine: formatPowerShellCommand({ command, args }),
    envOverrides,
    terminal: {
      columns: terminalColumns,
      rows: terminalRows,
      bytes: terminalBuffer.length
    },
    screen: {
      ...reconstructedScreen.stats,
      ...screenSummary
    },
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(startedAt + wallMs).toISOString(),
    wallMs,
    status,
    exitCode: childResult.exitCode,
    signal: childResult.signal,
    files,
    eventCount: events.length
  };
  await writeText(files.metaJson, `${JSON.stringify(meta, null, 2)}\n`);
  await writeText(files.summaryTxt, [
    `label: ${meta.label}`,
    `mode: pty`,
    `status: ${status}`,
    `exitCode: ${childResult.exitCode == null ? 'null' : childResult.exitCode}`,
    `signal: ${childResult.signal == null ? 'null' : childResult.signal}`,
    `wallMs: ${wallMs}`,
    `outputDir: ${outputDir}`,
    `terminalRaw: ${files.terminalRaw}`,
    `terminalPlain: ${files.terminalPlain}`,
    `screenTxt: ${files.screenTxt}`,
    `screenJson: ${files.screenJson}`,
    `eventsJsonl: ${files.eventsJsonl}`,
    `metaJson: ${files.metaJson}`,
    ''
  ].join('\n'));

  return meta;
};

export const captureSearchDebugRun = async ({
  rootDir = process.cwd(),
  searchArgs = [],
  logsRoot = null,
  label = null,
  cwd = rootDir,
  env = process.env,
  forceColor = true,
  searchEntrypoint = path.join(rootDir, 'search.js'),
  spawnImpl = spawn,
  trackedEnvKeys = [],
  outputSuffix = null,
  pty = false,
  cols = null,
  rows = null
} = {}) => {
  const normalizedArgs = Array.isArray(searchArgs)
    ? searchArgs.map((entry) => String(entry))
    : [];
  if (!normalizedArgs.length) {
    throw new Error('searchArgs must include at least one argument');
  }
  const effectiveLabel = label || deriveSearchLabel(normalizedArgs);
  const sharedOptions = {
    command: process.execPath,
    args: [path.resolve(searchEntrypoint), ...normalizedArgs],
    cwd,
    env,
    logsRoot,
    label: effectiveLabel,
    rootDir,
    forceColor,
    trackedEnvKeys,
    outputSuffix
  };
  if (pty) {
    return await captureCommandTerminalRun({
      ...sharedOptions,
      cols,
      rows
    });
  }
  return await captureCommandDebugRun({
    ...sharedOptions,
    spawnImpl,
    parseStdoutAsJson: true
  });
};
