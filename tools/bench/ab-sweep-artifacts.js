import path from 'node:path';
import { TextDecoder } from 'node:util';
import { readVerifiedContainedFileSync } from '../../src/shared/contained-file.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { admitBenchmarkObservation } from './runner-observation.js';
import { BENCH_REPORT_MAX_BYTES } from './runner-workload.js';
import { BENCH_EVIDENCE_RECORD_BYTES } from './evidence-contract.js';
import { createBenchmarkEvidenceRun } from './evidence-store.js';

export const AB_SWEEP_ARTIFACT_VERSION = 1;
export const AB_SWEEP_MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

/** The shared atomic owner publishes new files exclusively. Invocation paths
 * are never reused; final recommendations retain exact raw-report digests. */
export const createSweepArtifacts = async (root, context, { signal } = {}) => {
  const parent = path.join(root, '.testLogs', 'bench-ab-sweep');
  const evidence = await createBenchmarkEvidenceRun({ root, familyRoot: parent, family: 'ab-sweep', signal,
    requiredBytes: AB_SWEEP_MAX_ARTIFACT_BYTES + BENCH_REPORT_MAX_BYTES + BENCH_EVIDENCE_RECORD_BYTES + 65536 });
  const { runDir, runId: experimentId } = evidence, finalPath = path.join(runDir, 'final.json');
  try {
    await evidence.writeJson('owner.json', { ...context, version: AB_SWEEP_ARTIFACT_VERSION, kind: 'ab-sweep',
      experimentId, createdAt: new Date().toISOString() });
  } catch (error) {
    try { await evidence.finish(error, { failed: true }); }
    catch (secondary) { throw addStorageFailureContext(error, {}, secondary, { secondaryPresent: true }); }
    throw error;
  }
  let sealed = false;
  return Object.freeze({ experimentId, runDir, finalPath, registerReport: evidence.registerFile,
    trackExternal: evidence.trackExternal, expectReport: evidence.expectFile, close: evidence.finish,
    finish: async report => {
      if (sealed) throw new Error('A/B sweep already has an immutable final receipt.');
      if (report.experimentId !== experimentId || report.finalReceiptPath !== finalPath) throw new Error('A/B terminal receipt belongs to another invocation.');
      const text = JSON.stringify(report, null, 2) + '\n';
      if (Buffer.byteLength(text) > BENCH_REPORT_MAX_BYTES) throw new Error('A/B final report exceeds its fixed byte allowance.');
      evidence.markReferenced();
      await evidence.writeText('final.json', text);
      sealed = true;
      await evidence.finish(report);
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
