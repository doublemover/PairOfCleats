#!/usr/bin/env node
import { guardBootstrapEntry } from './src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);

import fs from 'node:fs';
import path from 'node:path';
const { parseBuildArgs } = await import('./src/index/build/args.js');
const { buildIndex } = await import('./src/integrations/core/index.js');
const { createDisplay } = await import('./src/shared/cli/display.js');
const { setProgressHandlers } = await import('./src/shared/progress-runtime.js');
const { buildAutoPolicy } = await import('./src/shared/auto-policy/build.js');
const { parseObservabilityContextEnv } = await import('./src/shared/observability.js');
const { resolveRuntimeEnvelope } = await import('./src/shared/runtime-envelope/resolve.js');
const { createAbortControllerWithHandlers, isAbortError } = await import('./src/shared/abort.js');
const { isDirectExecution } = await import('./src/shared/direct-execution.js');
const { setCacheRebuildEnv, setVerboseEnv } = await import('./src/shared/env.js');
const { emitLegacyCliEntrypointWarning } = await import('./src/shared/cli/legacy-entrypoint.js');
const {
  getCurrentBuildInfo,
  getRepoCacheRoot,
  getToolVersion,
  loadUserConfig,
  resolveRepoRoot
} = await import('./tools/shared/dict-utils.js');

const normalizePath = (value) => String(value || '').replace(/\//g, path.sep);

const formatPath = (value, localAppData, maxLength = 120) => {
  if (!value) return '';
  let normalized = normalizePath(value);
  if (localAppData && normalized.toLowerCase().startsWith(localAppData.toLowerCase())) {
    const suffix = normalized.slice(localAppData.length);
    const trimmed = suffix.startsWith(path.sep) ? suffix.slice(1) : suffix;
    normalized = `%localappdata%${path.sep}${trimmed}`;
  }
  if (normalized.length <= maxLength) return normalized;
  const head = normalized.startsWith('%localappdata%') ? `%localappdata%${path.sep}` : '';
  const remaining = normalized.slice(head.length);
  const tailLength = Math.max(10, maxLength - head.length - 3);
  const tail = remaining.slice(-tailLength);
  return `${head}...${tail}`;
};

export const main = async ({
  rawArgs = process.argv.slice(2),
  rawArgv = process.argv,
  cwd = process.cwd(),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) => {
  const { argv, modes } = parseBuildArgs(rawArgs);
  const rootArg = argv.repo ? path.resolve(argv.repo) : null;
  if (argv['config-dump'] === true) {
    const resolvedRoot = rootArg || resolveRepoRoot(cwd);
    const userConfig = loadUserConfig(resolvedRoot);
    const policy = await buildAutoPolicy({ repoRoot: resolvedRoot, config: userConfig });
    const envelope = resolveRuntimeEnvelope({
      argv,
      rawArgv: rawArgs,
      userConfig,
      autoPolicy: policy,
      env,
      toolVersion: getToolVersion()
    });
    const output = argv.json === true ? JSON.stringify(envelope) : JSON.stringify(envelope, null, 2);
    stdout.write(`${output}\n`);
    return 0;
  }
  if (argv.verbose === true) {
    setVerboseEnv(true);
  }
  if (argv['cache-rebuild'] === true) {
    setCacheRebuildEnv(true);
  }

  const display = createDisplay({
    stream: stderr,
    progressMode: argv.progress,
    verbose: argv.verbose === true,
    quiet: argv.quiet === true,
    json: argv.json === true
  });
  const restoreHandlers = setProgressHandlers(display);
  const supportsColor = stderr.isTTY
    && argv.json !== true
    && argv.progress !== 'jsonl'
    && argv.progress !== 'json';
  const doneLabel = supportsColor
    ? '\x1b[97m[\x1b[92mDONE\x1b[97m]\x1b[0m'
    : '[DONE]';
  const writeLine = (line) => {
    if (line === null || line === undefined) return;
    if (argv.progress === 'jsonl') {
      display.log(String(line));
      return;
    }
    stderr.write(`${line}\n`);
  };
  const localAppData = env.LOCALAPPDATA || '';
  let displayClosed = false;
  const closeDisplay = () => {
    if (displayClosed) return;
    if (typeof display.flush === 'function') {
      display.flush();
    }
    restoreHandlers();
    display.close();
    displayClosed = true;
  };
  const startedAt = Date.now();
  const resolvedRoot = rootArg || resolveRepoRoot(cwd);
  const observability = parseObservabilityContextEnv(env);
  const repoCacheRoot = getRepoCacheRoot(resolvedRoot);
  const crashLogPath = repoCacheRoot
    ? path.join(repoCacheRoot, 'logs', 'index-crash.log')
    : null;
  const abortController = createAbortControllerWithHandlers();
  const handleSigint = () => abortController.abort('SIGINT');
  const handleSigterm = () => abortController.abort('SIGTERM');
  process.on('SIGINT', handleSigint);
  process.on('SIGTERM', handleSigterm);
  try {
    const result = await buildIndex(resolvedRoot, {
      ...argv,
      modes,
      rawArgv,
      abortSignal: abortController.signal,
      observability
    });
    if (result?.stage3?.embeddings?.cancelled) {
      closeDisplay();
      const cancellation = result.stage3.embeddings;
      const signal = cancellation.signal || abortController.signal.reason;
      writeLine(`Index build cancelled during embeddings${signal ? ` (${signal})` : ''}; validation and promotion did not complete.`);
      return signal === 'SIGTERM' ? 143 : 130;
    }
    const preprocessPath = repoCacheRoot
      ? path.join(repoCacheRoot, 'preprocess.json')
      : null;
    const seconds = Math.round(Math.max(0, (Date.now() - startedAt) / 1000));
    let summary = `Index built in ${seconds} seconds.`;
    let detailLines = [];
    try {
      if (preprocessPath && fs.existsSync(preprocessPath)) {
        const stats = JSON.parse(fs.readFileSync(preprocessPath, 'utf8'));
        const modeStats = stats?.modes || {};
        const fmt = (value) => Number.isFinite(value) ? value.toLocaleString() : '0';
        const code = modeStats.code || {};
        const prose = modeStats.prose || {};
        const extracted = modeStats['extracted-prose'] || {};
        const records = modeStats.records || {};
        const codeFiles = Number.isFinite(code.included) ? code.included : 0;
        const proseFiles = Number.isFinite(prose.included) ? prose.included : 0;
        const recordsFiles = Number.isFinite(records.included) ? records.included : 0;
        const totalFiles = codeFiles + proseFiles + recordsFiles;
        const codeLines = Number.isFinite(code.lines) ? code.lines : 0;
        const proseLines = Number.isFinite(prose.lines) ? prose.lines : 0;
        const recordsLines = Number.isFinite(records.lines) ? records.lines : 0;
        const totalLines = codeLines + proseLines + recordsLines;
        const extractedFiles = Number.isFinite(extracted.included) ? extracted.included : 0;
        const extractedLines = Number.isFinite(extracted.lines) ? extracted.lines : 0;
        summary = `Index built for ${fmt(totalFiles)} files in ${seconds} seconds (${fmt(totalLines)} lines).`;
        const detailEntries = [
          { label: 'Code', value: `${fmt(codeFiles)} files`, lines: fmt(codeLines) },
          { label: 'Prose', value: `${fmt(proseFiles)} files`, lines: fmt(proseLines) },
          { label: 'Extracted Prose', value: `${fmt(extractedFiles)} files`, lines: fmt(extractedLines) },
          { label: 'Records', value: `${fmt(recordsFiles)} records`, lines: fmt(recordsLines) }
        ];
        const maxLabelLength = detailEntries.reduce((max, entry) => Math.max(max, entry.label.length), 0);
        const maxValueLength = detailEntries.reduce((max, entry) => Math.max(max, entry.value.length), 0);
        const colonColumn = Math.max(36, maxLabelLength + 2);
        const baseIndent = Math.max(0, colonColumn - maxLabelLength);
        detailLines = detailEntries.map((entry) => {
          const labelPad = ' '.repeat(maxLabelLength - entry.label.length);
          const valuePad = ' '.repeat(maxValueLength - entry.value.length);
          const indent = ' '.repeat(baseIndent);
          return `${indent}${labelPad}${entry.label}: ${entry.value}${valuePad} (${entry.lines} lines).`;
        });
      }
    } catch {}
    closeDisplay();
    writeLine(`${doneLabel} ${summary}`);
    for (const line of detailLines) {
      writeLine(line);
    }
    return 0;
  } catch (err) {
    if (isAbortError(err)) {
      display.error('Index build aborted.');
    } else {
      display.error(`Index build failed: ${err?.message || err}`);
      if (argv.verbose === true && err?.stack) {
        display.error(err.stack);
      }
    }
    if (crashLogPath) {
      display.error(`Crash log: ${formatPath(crashLogPath, localAppData)}`);
    }
    return 1;
  } finally {
    process.off('SIGINT', handleSigint);
    process.off('SIGTERM', handleSigterm);
    closeDisplay();
  }
};

export const runCli = async (options = {}) => {
  try {
    const exitCode = await main(options);
    process.exitCode = Number.isFinite(Number(exitCode)) ? Number(exitCode) : 0;
    return process.exitCode;
  } catch (error) {
    const stderr = options?.stderr || process.stderr;
    stderr.write(`Index build failed: ${error?.message || error}\n`);
    process.exitCode = 1;
    return 1;
  }
};

if (isDirectExecution(import.meta.url)) {
  emitLegacyCliEntrypointWarning({
    entrypoint: 'build_index.js',
    replacement: 'pairofcleats index build',
    args: process.argv.slice(2)
  });
  void runCli();
}
