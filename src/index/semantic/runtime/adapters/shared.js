import { semanticHash } from '../../identity.js';
import { joinRuntimeSource } from '../plan.js';

export const OFFLINE_RUNTIME_PARSER = Object.freeze({ id: 'pairofcleats-offline-runtime', version: '1' });
export const runtimeEventLimit = capture => Math.min(capture.limits.maxEvents, 100000,
  Math.floor(capture.limits.processTreeMemoryBytes / 4096));
export const unknownFields = (value, keys) => Object.keys(value || {}).some(key => !keys.includes(key));
export const createAdapterCoverage = artifact => ({ artifactId: artifact.artifactId, status: 'complete',
  observedRecords: 0, droppedRecords: 0, reasons: [] });
export const markRuntimeCoverage = (coverage, reason, dropped = 0, status = 'partial') => {
  if (!coverage.reasons.includes(reason)) coverage.reasons.push(reason);
  if (coverage.status === 'complete' || status === 'unsupported' || status === 'malformed') coverage.status = status;
  coverage.droppedRecords += dropped;
};
export const createRuntimeObservation = ({ capture, artifact, kind, data, sourceHash = null,
  sourceCandidates, byteRange = null, timestamp = null, identity, unavailable = [], warnings = [] }) => ({
  schemaVersion: 1, evidenceId: 're1:' + semanticHash('pairofcleats.runtime.observation.v1', {
    captureId: capture.captureId, scope: capture.scope, workload: capture.workload,
    artifactId: artifact.artifactId, hash: artifact.hash, kind, identity, data
  }), captureId: capture.captureId, projectionVersion: '1', kind, evidenceClass: 'observed',
  scope: capture.scope, clock: capture.clock, timestamp, workload: capture.workload,
  join: joinRuntimeSource({ sourceHash, candidates: sourceCandidates }),
  rawRefs: [{ artifactId: artifact.artifactId, hash: artifact.hash, byteRange }], unavailable, warnings, data
});
