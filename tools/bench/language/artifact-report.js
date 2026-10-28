import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSubprocessSync } from '../../../src/shared/subprocess/runner.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';

const MAX_BYTES = 32 * 1024 * 1024;
const reportScript = fileURLToPath(new URL('../../index/report-artifacts.js', import.meta.url));
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
