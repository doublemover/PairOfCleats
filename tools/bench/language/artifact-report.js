import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSubprocessSync } from '../../../src/shared/subprocess/runner.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { bakeoffPhaseFailureReceipt } from '../embeddings/bakeoff-phase.js';
import { redactDiagnosticText } from '../../../src/shared/diagnostic-text.js';

const MAX_BYTES = 32 * 1024 * 1024;
const reportScript = fileURLToPath(new URL('../../index/report-artifacts.js', import.meta.url));
const canonicalRoot = root => process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (reason, result, cause = undefined) => {
  const error = new Error(`Benchmark artifact report failed: ${reason}.`, { cause });
  error.code = 'ERR_BENCH_ARTIFACT_REPORT';
  error.reason = reason;
  Object.defineProperty(error, 'artifactReportChild', { value: result });
  return error;
};

/** A successful child exit is necessary, not sufficient. Consume only complete
 * captured JSON from this repository's actual artifact-report command. */
export const readBenchmarkArtifactReport = (result, { repoRoot }) => {
  observeStorageResource(result, { phase: 'benchmark-artifact-report-result' }).requireSettled();
  if (result?.exitCode !== 0 || result?.signal) throw failure('child-failed', result);
  const capture = result.outputCapture?.stdout;
  if (!capture?.enabled || capture.truncated !== false || capture.encodingLoss !== false || capture.droppedBytes !== 0
    || typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > MAX_BYTES
    || capture.outputBytes !== Buffer.byteLength(result.stdout)) throw failure('capture-incomplete', result);
  let report;
  try { report = JSON.parse(result.stdout); }
  catch (cause) { throw failure('malformed-json', result, cause); }
  if (!object(report) || !object(report.repo) || typeof report.repo.root !== 'string'
    || !path.isAbsolute(report.repo.root) || !object(report.throughput)) throw failure('unsupported-report', result);
  let expected, reported;
  try {
    expected = fs.realpathSync.native(path.resolve(repoRoot));
    reported = fs.realpathSync.native(report.repo.root);
  } catch (cause) {
    observeStorageResource(cause, { phase: 'benchmark-artifact-report-root' }).requireSettled();
    throw failure('root-unavailable', result, cause);
  }
  if (expected !== reported) throw failure('repository-mismatch', result);
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  return { report, receipt: Object.freeze({ state: 'complete-command-output',
    scope: 'artifact-report-command', repoRoot: reported, exitCode: 0,
    stdout: { ...capture }, stderr: { ...(result.outputCapture?.stderr || {}), preview: stderr.slice(0, 4096),
      previewTruncated: stderr.length > 4096, hasDiagnostics: stderr.trim().length > 0 } }) };
};

export const collectBenchmarkArtifactReport = ({ repoRoot, env = process.env }) => {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) throw new TypeError('Benchmark artifact reporting requires its selected repository.');
  const selected = path.resolve(repoRoot);
  const result = spawnSubprocessSync(process.execPath, [reportScript, '--repo', selected, '--json'], {
    cwd: selected, env, outputMode: 'string', captureStdout: true, captureStderr: true,
    maxOutputBytes: MAX_BYTES, timeoutMs: 30000, rejectOnNonZeroExit: false,
    name: 'benchmark artifact report'
  });
  return readBenchmarkArtifactReport(result, { repoRoot: selected });
};

/** The final coherent status snapshot may describe another publication. Join
 * only when every measured source selection agrees with its exact mode root. */
export const qualifyBenchmarkArtifactGeneration = (report, observations) => {
  const sources = new Map();
  if (!Array.isArray(observations) || !observations.length) return { state: 'unavailable', reason: 'measured-generations-missing' };
  for (const observation of observations) {
    if (observation?.status !== 'qualified' || observation?.consistency !== 'stable'
      || observation?.omittedReceipts > 0 || !observation?.receipts?.length) return { state: 'unavailable', reason: 'measured-generation-coverage-incomplete' };
    for (const row of observation.receipts) for (const mode of row.receipt.modes) {
      const generation = row.receipt.generations?.[mode];
      if (!generation?.activeBuildRoot || !generation.buildId) return { state: 'unavailable', reason: 'measured-generation-unknown' };
      const root = canonicalRoot(generation.activeBuildRoot), previous = sources.get(mode);
      if (previous && (previous.root !== root || previous.buildId !== generation.buildId)) return { state: 'incompatible', reason: 'measured-generations-mixed' };
      sources.set(mode, { root, buildId: generation.buildId });
    }
  }
  for (const [mode, selected] of sources) {
    const current = report?.repo?.indexDirs?.[mode];
    if (!current || canonicalRoot(path.dirname(current)) !== selected.root) return { state: 'incompatible', reason: 'publication-changed-before-artifact-collection', mode };
  }
  return { state: 'qualified', scope: 'measured-per-mode-generation-to-artifact-snapshot', modes: Object.fromEntries(sources) };
};

export const benchmarkArtifactFailureReceipt = error => {
  observeStorageResource(error, { phase: 'benchmark-artifact-report-failure' }).requireSettled();
  const data = (value, key) => {
    try { return value && Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
  };
  const child = data(error, 'artifactReportChild') || data(error, 'result');
  const receipt = bakeoffPhaseFailureReceipt({ cause: error, result: child,
    code: data(error, 'code') || 'ERR_BENCH_ARTIFACT_REPORT', message: data(error, 'message') || 'Benchmark artifact collection failed.' });
  const reason = data(error, 'reason'), name = data(error, 'name'), causeCode = data(data(error, 'cause'), 'code');
  return { schemaVersion: 1, state: 'failed-required-phase', code: receipt.code,
    reason: typeof reason === 'string' ? redactDiagnosticText(reason, 256) : 'artifact-collection-failed',
    cause: { name: typeof name === 'string' ? redactDiagnosticText(name, 128) : 'Error', message: receipt.message,
      code: typeof causeCode === 'string' ? redactDiagnosticText(causeCode, 128) : null },
    child: child ? { exitCode: receipt.exitCode, signal: receipt.signal,
      outputCapture: receipt.outputCapture, stderr: receipt.stderrTail } : null };
};
