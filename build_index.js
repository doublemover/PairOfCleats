#!/usr/bin/env node
import { guardBootstrapEntry } from './src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);

import path from 'node:path';
const { parseBuildArgs } = await import('./src/index/build/args.js');
const { buildIndex } = await import('./src/integrations/core/index.js');
const { createBuildIndexOutcome, describeBuildIndexOutcome } = await import('./src/integrations/core/build-index/outcome.js');
const { createDisplay } = await import('./src/shared/cli/display.js');
const { setProgressHandlers } = await import('./src/shared/progress-runtime.js');
const { buildAutoPolicy } = await import('./src/shared/auto-policy/build.js');
const { parseObservabilityContextEnv } = await import('./src/shared/observability.js');
const { createRuntimePreview } = await import('./src/shared/runtime-envelope/preview.js');
const { resolveCurrentProcessRuntimeEnvelope } = await import('./src/shared/runtime-envelope/resolve-current-process-envelope.js');
const { createAbortControllerWithHandlers, isAbortError } = await import('./src/shared/abort.js');
const { isDirectExecution } = await import('./src/shared/direct-execution.js');
const { setVerboseEnv } = await import('./src/shared/env.js');
const { emitLegacyCliEntrypointWarning } = await import('./src/shared/cli/legacy-entrypoint.js');
const { resolveConfirmedCrashEvidencePath } = await import('./src/index/build/crash-evidence.js');
const {
  getToolVersion,
  loadUserConfig,
  resolveRepoRoot
} = await import('./tools/shared/dict-utils.js');

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
    let configSources = null;
    const userConfig = loadUserConfig(resolvedRoot, { onSources: (sources) => { configSources = sources; } });
    const quality = typeof argv.quality === 'string' ? argv.quality.trim().toLowerCase() : '';
    const policy = await buildAutoPolicy({
      repoRoot: resolvedRoot,
      config: quality ? { ...userConfig, quality } : userConfig
    });
    const envelope = resolveCurrentProcessRuntimeEnvelope({
      argv,
      rawArgv: rawArgs,
      userConfig,
      autoPolicy: policy,
      env,
      toolVersion: getToolVersion()
    });
    const preview = await createRuntimePreview({ repoRoot: resolvedRoot, userConfig, policy, envelope, argv, configSources });
    const output = argv.json === true ? JSON.stringify(preview) : JSON.stringify(preview, null, 2);
    stdout.write(`${output}\n`);
    return 0;
  }
  if (argv.verbose === true) {
    setVerboseEnv(true);
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
    if (display.jsonl) {
      display.log(String(line));
      return;
    }
    stderr.write(`${line}\n`);
  };
  let displayClosed = false;
  let terminalEmitted = false;
  let outputCleanupFailed = false;
  const emitTerminal = (outcome, message) => {
    if (terminalEmitted) return;
    terminalEmitted = true;
    restoreHandlers();
    displayClosed = true;
    display.finalize(cleanupError => {
      if (cleanupError) {
        outputCleanupFailed = true;
        outcome = { ...outcome, status: 'failed', cleanupError: { message: String(cleanupError.message || cleanupError) } };
        message = `Index command output cleanup failed: ${cleanupError.message || cleanupError}`;
      }
      if (argv.json) stdout.write(`${JSON.stringify(outcome)}\n`);
      else if (display.jsonl) display.log(message, { kind: 'terminal-outcome', outcome, forceOutput: true });
      else stderr.write(`${message}\n`);
    });
  };
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
    if (result?.outcome?.status === 'cancelled') {
      const cancellation = result.stage3?.embeddings || result.embeddings || {};
      const signal = cancellation.signal || abortController.signal.reason;
      emitTerminal(result.outcome, `Index build cancelled during embeddings${signal ? ` (${signal})` : ''}; validation and promotion did not complete.`);
      return signal === 'SIGTERM' ? 143 : 130;
    }
    const outcome = result.outcome;
    const seconds = Math.round(Math.max(0, (Date.now() - startedAt) / 1000));
    emitTerminal(outcome, `${doneLabel} ${describeBuildIndexOutcome(outcome, seconds)}`);
    for (const generation of outcome.generations) {
      if (!argv.json && !display.jsonl && generation.receiptPath) writeLine(`Build evidence: ${generation.receiptPath}`);
    }
    return outputCleanupFailed ? 1 : 0;
  } catch (err) {
    if (isAbortError(err)) {
      display.error('Index build aborted.');
    } else {
      display.error(`Index build failed: ${err?.message || err}`);
      if (argv.verbose === true && err?.stack) {
        display.error(err.stack);
      }
    }
    const evidencePath = resolveConfirmedCrashEvidencePath(err?.diagnosticEvidence);
    if (evidencePath) writeLine(`Failure evidence: ${evidencePath}`);
    else if (err?.diagnosticEvidence?.writeError) writeLine(`Failure evidence unavailable: ${err.diagnosticEvidence.writeError.message}`);
    emitTerminal(err.outcome || createBuildIndexOutcome({ repo: resolvedRoot, error: err }),
      isAbortError(err) ? 'Index build aborted.' : `Index build failed: ${err?.message || err}`);
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
