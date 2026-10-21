import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { throwIfAborted, isAbortError } from '../../../src/shared/abort.js';

// Protocol JSON cannot supply this binding. Collectors name approved roots;
// stat observations alone never enter the action registry as authority.
const scopes = new WeakMap();
export const bindArtifactScope = (row, { root, repoRoot }) => {
  scopes.set(row, Object.freeze({ root: path.resolve(root), repoRoot: path.resolve(repoRoot), target: path.resolve(row.path) }));
  return row;
};
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const fileIdentity = stat => Object.freeze({ dev: stat.dev.toString(), ino: stat.ino.toString() });
const errorCode = error => String(error?.code || 'ERR_TUI_ARTIFACT_UNAVAILABLE').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 80);

/** Bounded, revocable snapshots owned by actual job instances. */
export const createTuiArtifactRegistry = ({ maxJobs = 8, maxArtifacts = 64,
  maxFileBytes = 8 * 1024 * 1024, maxTotalBytes = 16 * 1024 * 1024 } = {}) => {
  for (const [value, ceiling] of [[maxJobs, 64], [maxArtifacts, 64],
    [maxFileBytes, 8 * 1024 * 1024], [maxTotalBytes, 16 * 1024 * 1024]]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > ceiling) throw new TypeError('Invalid artifact registry bound.');
  }
  const records = new Map(), lifetime = new AbortController(), work = new Set();
  let disposed = false;
  const current = (sourceJobId, generation) => {
    if (disposed) fail('ERR_TUI_ARTIFACT_SESSION', 'Artifact session is closed.');
    const record = records.get(sourceJobId);
    if (!record || record.generation !== generation) fail('ERR_TUI_ARTIFACT_STALE', 'Artifact inventory is no longer current.');
    return record;
  };
  const signalFor = (record, signal) => AbortSignal.any([lifetime.signal, record.controller.signal, ...(signal ? [signal] : [])]);
  const beginJob = sourceJobId => {
    if (disposed) fail('ERR_TUI_ARTIFACT_SESSION', 'Artifact session is closed.');
    if (typeof sourceJobId !== 'string' || !sourceJobId || sourceJobId.length > 128 || /[\x00-\x1f\x7f]/.test(sourceJobId)) {
      fail('ERR_TUI_ARTIFACT_SCOPE', 'Job identity is unavailable for artifact actions.');
    }
    records.get(sourceJobId)?.controller.abort();
    records.delete(sourceJobId);
    while (records.size >= maxJobs) {
      const id = records.keys().next().value;
      records.get(id).controller.abort(); records.delete(id);
    }
    const generation = randomUUID();
    records.set(sourceJobId, { generation, controller: new AbortController(), pins: new Map() });
    return generation;
  };
  const capture = async ({ sourceJobId, generation, artifacts, signal = null }) => {
    const record = current(sourceJobId, generation), scopedSignal = signalFor(record, signal);
    const pins = new Map(), rows = [];
    let remainingBytes = maxTotalBytes;
    for (const row of (Array.isArray(artifacts) ? artifacts : []).slice(0, maxArtifacts)) {
      throwIfAborted(scopedSignal);
      const scope = scopes.get(row);
      let pin;
      try {
        if (!scope) fail('ERR_TUI_ARTIFACT_SCOPE', 'Artifact has no approved collector scope.');
        assertNoSymlinkPath(scope.root, scope.target);
        const stat = await fs.stat(scope.target, { bigint: true });
        assertNoSymlinkPath(scope.root, scope.target);
        if (stat.isDirectory()) {
          pin = { ...scope, type: 'directory', fileIdentity: fileIdentity(stat) };
        } else {
          const read = await readVerifiedContainedFile(scope.root, scope.target, {
            maxBytes: Math.min(maxFileBytes, remainingBytes), signal: scopedSignal
          });
          remainingBytes -= read.buffer.length;
          pin = { ...scope, type: 'file', fileIdentity: read.fileIdentity, hash: read.hash, bytes: read.buffer.length };
        }
        current(sourceJobId, generation);
        const artifactId = randomUUID();
        pins.set(artifactId, Object.freeze(pin));
        rows.push({ ...row, path: scope.target, artifactId, snapshotVerified: true,
          actions: pin.type === 'file' ? ['open', 'copy', 'export'] : ['open', 'copy'] });
      } catch (error) {
        if (isAbortError(error) || scopedSignal.aborted) throw error;
        rows.push({ ...row, snapshotVerified: false, actions: [], unavailableCode: errorCode(error) });
      }
    }
    throwIfAborted(scopedSignal); current(sourceJobId, generation);
    record.pins = pins;
    return { inventoryId: generation, artifacts: rows };
  };
  const resolve = async ({ sourceJobId, inventoryId, artifactId }, { signal = null } = {}) => {
    const record = current(sourceJobId, inventoryId), scopedSignal = signalFor(record, signal);
    throwIfAborted(scopedSignal);
    const pin = record.pins.get(artifactId);
    if (!pin) fail('ERR_TUI_ARTIFACT_UNAVAILABLE', 'Choose an available artifact from this job inventory.');
    let read = null;
    if (pin.type === 'file') {
      read = await readVerifiedContainedFile(pin.root, pin.target, { signal: scopedSignal,
        maxBytes: maxFileBytes, expectedBytes: pin.bytes, expectedHash: pin.hash, expectedFileIdentity: pin.fileIdentity });
    } else {
      assertNoSymlinkPath(pin.root, pin.target);
      const stat = await fs.stat(pin.target, { bigint: true });
      assertNoSymlinkPath(pin.root, pin.target);
      if (!stat.isDirectory() || stat.dev.toString() !== pin.fileIdentity.dev || stat.ino.toString() !== pin.fileIdentity.ino) {
        fail('ERR_FILE_CHANGED', 'Artifact directory changed since it was recorded.');
      }
    }
    throwIfAborted(scopedSignal); current(sourceJobId, inventoryId);
    return { pin, read, signal: scopedSignal };
  };
  const track = operation => async (...args) => {
    const pending = operation(...args);
    work.add(pending);
    try { return await pending; } finally { work.delete(pending); }
  };
  return { beginJob, capture: track(capture), resolve: track(resolve),
    assertCurrent: (sourceJobId, inventoryId) => { current(sourceJobId, inventoryId); },
    async dispose() {
      if (!disposed) {
        disposed = true; lifetime.abort();
        for (const record of records.values()) record.controller.abort();
        records.clear();
      }
      await Promise.allSettled([...work]);
    }
  };
};
