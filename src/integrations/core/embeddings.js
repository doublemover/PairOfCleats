import { resolveEmbeddingIntent } from '../../shared/embedding-intent.js';
import { getEnvConfig } from '../../shared/env/runtime.js';
import { StringDecoder } from 'node:string_decoder';
import { spawnSubprocess, SubprocessError } from '../../shared/subprocess/runner.js';
import path from 'node:path';
import { getRepoCacheRoot, loadUserConfig } from '../../shared/dict-utils.js';
import { createCrashEvidenceOwner, boundedCrashEvent, redactCrashArguments } from '../../index/build/crash-evidence.js';
import { redactDiagnosticText } from '../../shared/diagnostic-text.js';
import { readRuntimeReceipt } from '../../shared/runtime-envelope/read-receipt.js';
import { persistRuntimeAttempt } from '../../index/build/build-state/runtime.js';

const EMBEDDINGS_CANCEL_CODE = 0xC000013A;

const createLineEmitter = (onLine) => {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  const emitLine = (line) => {
    const trimmed = line.trimEnd();
    if (trimmed) onLine(trimmed);
  };
  const handleChunk = (chunk) => {
    const text = Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk);
    buffer += text;
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() || '';
    for (const line of parts) emitLine(line);
  };
  const flush = () => {
    const tail = decoder.end();
    if (tail) buffer += tail;
    if (buffer) emitLine(buffer);
    buffer = '';
  };
  return { handleChunk, flush };
};

export const resolveEmbeddingRuntime = ({ argv, userConfig, policy, envConfig = getEnvConfig() }) => {
  const embeddingsConfig = userConfig?.indexing?.embeddings || {};
  const intent = resolveEmbeddingIntent({ argv, embeddingsConfig, envConfig,
    policyEnabled: policy?.indexing?.embeddings?.enabled });
  const queueDir = typeof embeddingsConfig.queue?.dir === 'string'
    ? embeddingsConfig.queue.dir.trim()
    : '';
  const queueMaxRaw = Number(embeddingsConfig.queue?.maxQueued);
  const queueMaxQueued = Number.isFinite(queueMaxRaw)
    ? Math.max(0, Math.floor(queueMaxRaw))
    : null;
  return {
    ...intent,
    queueDir,
    queueMaxQueued
  };
};

export const runEmbeddingsTool = async (args, options = {}) => {
  const onLine = typeof options.onLine === 'function' ? options.onLine : null;
  const emitter = onLine ? createLineEmitter(onLine) : null;
  const baseEnv = options.baseEnv && typeof options.baseEnv === 'object'
    ? options.baseEnv
    : process.env;
  const extraEnv = options.extraEnv && typeof options.extraEnv === 'object'
    ? options.extraEnv
    : null;
  const env = extraEnv ? { ...baseEnv, ...extraEnv } : baseEnv;
  const argument = name => {
    const index = args.indexOf(name);
    return index >= 0 && typeof args[index + 1] === 'string' ? args[index + 1] : null;
  };
  const buildRoot = options.indexRoot || argument('--index-root');
  const mode = options.mode || argument('--mode') || 'all';
  let evidenceOwner = null;
  let evidenceSetupError = null;
  let priorAttemptIds = new Set();
  try {
    const repo = options.root || argument('--repo');
    const repoCacheRoot = options.repoCacheRoot || (repo ? getRepoCacheRoot(repo, options.userConfig || loadUserConfig(repo)) : null);
    if (repoCacheRoot) evidenceOwner = createCrashEvidenceOwner({ repoCacheRoot,
      buildId: buildRoot ? path.basename(buildRoot) : null, mode, stage: 'stage3',
      attemptId: options.attemptId || null, parentAttemptId: options.parentAttemptId || null,
      runtimeReceiptPath: buildRoot ? path.join(buildRoot, 'build_state.json') : null });
    if (buildRoot) priorAttemptIds = new Set((await readRuntimeReceipt({ buildRoot })).attempts.map(attempt => attempt.attemptId));
  } catch (error) { evidenceSetupError = error; }
  const persistOutcome = async (childResult, originalError, cancelled = false) => {
    if (!evidenceOwner) return { written: false, evidencePath: null,
      writeError: evidenceSetupError ? { code: evidenceSetupError.code || 'ERR_CRASH_EVIDENCE_SETUP',
        message: redactDiagnosticText(evidenceSetupError.message || evidenceSetupError) } : null };
    let attempts = [];
    try {
      if (buildRoot) attempts = (await readRuntimeReceipt({ buildRoot })).attempts.filter(attempt =>
        !priorAttemptIds.has(attempt.attemptId) && attempt.stage === 'stage3'
        && (mode === 'all' || attempt.mode === mode));
    } catch { /* Terminal child evidence remains independent of receipt availability. */ }
    const tail = value => {
      const text = Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : '';
      return { text: redactDiagnosticText(text.slice(-4096), 4096),
        capturedChars: text.length, retainedChars: Math.min(4096, text.length), truncated: text.length > 4096 };
    };
    const reference = evidenceOwner.writeTerminal({ category: 'tooling', stage: 'embeddings',
      message: redactDiagnosticText(originalError?.message || (cancelled ? 'Embedding child cancelled.' : 'Embedding child failed.'), 4096),
      code: originalError?.code || null,
      outcome: cancelled ? 'cancelled' : childResult?.signal ? 'signal' : childResult?.pid == null ? 'spawn-error' : 'nonzero-exit',
      child: { executable: process.execPath, arguments: redactCrashArguments(args),
        pid: childResult?.pid ?? null, parentPid: process.pid,
        exitCode: childResult?.exitCode ?? null, signal: childResult?.signal || null,
        stdout: tail(childResult?.stdout), stderr: tail(childResult?.stderr),
        outputCapture: boundedCrashEvent(childResult?.outputCapture || {}),
        detailAvailable: Boolean(childResult?.stdout?.length || childResult?.stderr?.length),
        runtimeAttemptIds: attempts.map(attempt => attempt.attemptId) } });
    if (reference.written && buildRoot) {
      for (const projected of attempts) {
        const { freshness, explanation, ...attempt } = projected;
        try {
          await persistRuntimeAttempt(buildRoot, attempt, {
            lifecycle: cancelled ? 'aborted' : 'failed',
            error: { ...(attempt.error || {}), code: String(originalError?.code || 'EMBEDDING_CHILD_FAILED'),
              message: redactDiagnosticText(originalError?.message || 'Embedding child terminated.'), diagnosticEvidence: reference }
          });
        } catch (error) {
          reference.receiptLinkError = { code: error?.code || 'ERR_CRASH_RECEIPT_LINK', message: redactDiagnosticText(error?.message || error) };
        }
      }
    }
    return reference;
  };
  const attachEvidence = (error, reference) => {
    try { error.diagnosticEvidence = reference; } catch {}
  };
  let result;
  try {
    result = await spawnSubprocess(process.execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      signal: options.signal || null,
      rejectOnNonZeroExit: false,
      onStdout: emitter ? emitter.handleChunk : null,
      onStderr: emitter ? emitter.handleChunk : null
    });
  } catch (error) {
    try { attachEvidence(error, await persistOutcome(error?.result, error, options.signal?.aborted === true)); }
    catch (diagnosticError) { attachEvidence(error, { written: false, evidencePath: null,
      writeError: { code: diagnosticError?.code || 'ERR_CRASH_EVIDENCE_WRITE', message: redactDiagnosticText(diagnosticError?.message || diagnosticError) } }); }
    throw error;
  } finally {
    emitter?.flush();
  }
  if (result.exitCode === 0 && !result.signal) {
    return { ok: true };
  }
  if (options.signal?.aborted
    || (Number.isInteger(result.exitCode) && (result.exitCode >>> 0) === EMBEDDINGS_CANCEL_CODE)) {
    const diagnosticEvidence = await persistOutcome(result, null, true);
    return { cancelled: true, code: result.exitCode ?? null, signal: result.signal || null, diagnosticEvidence };
  }
  const pickText = (value) => {
    if (Array.isArray(value)) return value.join('\n');
    if (typeof value === 'string') return value;
    return '';
  };
  const stderrText = pickText(result.stderr).trim();
  const stdoutText = pickText(result.stdout).trim();
  const details = stderrText || stdoutText;
  const detailTail = details
    ? details.slice(-4000)
    : '';
  const termination = result.signal
    ? `was terminated by signal ${result.signal}`
    : `exited with code ${result.exitCode ?? 'unknown'}`;
  const errorMessage = `build-embeddings ${termination}${detailTail ? `\n${detailTail}` : ''}`;
  const error = new SubprocessError(errorMessage, result);
  try { attachEvidence(error, await persistOutcome(result, error)); }
  catch (diagnosticError) { attachEvidence(error, { written: false, evidencePath: null,
    writeError: { code: diagnosticError?.code || 'ERR_CRASH_EVIDENCE_WRITE', message: redactDiagnosticText(diagnosticError?.message || diagnosticError) } }); }
  throw error;
};
