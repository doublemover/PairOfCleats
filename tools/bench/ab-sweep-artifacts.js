import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { TextDecoder } from 'node:util';
import { assertNoSymlinkPath, readVerifiedContainedFileSync } from '../../src/shared/contained-file.js';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { admitBenchmarkObservation } from './runner-observation.js';

export const AB_SWEEP_ARTIFACT_VERSION = 1;

/** The shared atomic owner publishes new files exclusively. Invocation paths
 * are never reused; final recommendations retain exact raw-report digests. */
export const createSweepArtifacts = async (root, context) => {
  const parent = path.join(root, '.testLogs', 'bench-ab-sweep');
  assertNoSymlinkPath(root, parent, { allowMissing: true });
  await fs.mkdir(parent, { recursive: true });
  assertNoSymlinkPath(root, parent);
  const runDir = await fs.mkdtemp(path.join(parent, 'run-'));
  const experimentId = crypto.randomUUID(), finalPath = path.join(runDir, 'final.json');
  const owner = { version: AB_SWEEP_ARTIFACT_VERSION, kind: 'ab-sweep', experimentId,
    createdAt: new Date().toISOString(), ...context };
  await atomicWriteJson(path.join(runDir, 'owner.json'), owner, { createOnly: true });
  let sealed = false;
  return Object.freeze({ experimentId, runDir, finalPath, finish: async report => {
    if (sealed) throw new Error('A/B sweep already has an immutable final receipt.');
    if (report.experimentId !== experimentId || report.finalReceiptPath !== finalPath) throw new Error('A/B terminal receipt belongs to another invocation.');
    await atomicWriteJson(finalPath, report, { createOnly: true });
    sealed = true;
  } });
};

const tail = (value, limit) => typeof value === 'string' ? value.slice(-limit) : null;
const projectRow = row => {
  if (!row || typeof row !== 'object') return null;
  const { id, script, absScript, args, required, ok, status, processOk, signal, processFailure,
    skipped, skipReason, parsedOk, timedOut, exitCode, durationMs, outputCapture } = row;
  const admitted = admitBenchmarkObservation(row.json?.benchmarkObservation);
  return { id, script, absScript, args, required, ok, status, processOk, signal, processFailure,
    skipped, skipReason, parsedOk, timedOut, exitCode, durationMs, outputCapture,
    errors: Array.isArray(row.errors) ? row.errors.slice(0, 16).map(error => tail(error, 512)) : [],
    json: { benchmarkObservation: admitted.ok ? admitted.observation : null },
    observationAdmission: admitted.ok ? 'qualified' : admitted.reason,
    stderrTail: tail(row.stderr ?? row.stderrTail, 2048), stdoutTail: tail(row.stdout ?? row.stdoutTail, 512) };
};

/** A nonzero process can still have a valuable complete report. Read that
 * exact contained file, including its actual failed rows, without stdout or
 * synthetic-empty-result substitution. Keep large diagnostics only on disk. */
export const readSweepVariantReport = (runDir, file, maxBytes) => {
  let read;
  try { read = readVerifiedContainedFileSync(runDir, file, { maxBytes }); }
  catch (error) {
    observeStorageResource(error, { phase: 'ab-sweep-report-read' }).requireSettled();
    return { report: null, reportReceipt: null, reportError: error.code === 'ENOENT' ? 'missing-report' : 'unreadable-or-oversized-report' };
  }
  const reportReceipt = { version: AB_SWEEP_ARTIFACT_VERSION, path: file, bytes: read.buffer.length, sha256: 'sha256:' + read.hash };
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.buffer));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Report must be an object.');
    const summary = value.summary && Object.fromEntries(['ok', 'error', 'timeout', 'skipped'].map(key => [key, value.summary[key]]));
    return { reportError: null, reportReceipt, report: {
      schemaVersion: value.schemaVersion, experiment: value.experiment, workload: value.workload,
      sourceValidation: value.sourceValidation, reportAdmission: value.reportAdmission, runner: value.runner,
      summary, results: Array.isArray(value.results) ? value.results.map(projectRow) : null } };
  } catch (error) {
    observeStorageResource(error, { phase: 'ab-sweep-report-parse' }).requireSettled();
    return { report: null, reportReceipt, reportError: 'malformed-report' };
  }
};
