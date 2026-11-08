import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { TextDecoder } from 'node:util';
import { withFileLock } from '../../../src/shared/locks/file-lock.js';
import { atomicWriteText } from '../../../src/shared/io/atomic-write.js';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { createBenchmarkEvidenceRun } from '../evidence-store.js';
import { BENCH_EVIDENCE_RECORD_BYTES } from '../evidence-contract.js';

export const BAKEOFF_CHECKPOINT_VERSION = 1;
export const BAKEOFF_CHECKPOINT_MAX_BYTES = 32 * 1024 * 1024;
const hash = value => 'sha256:' + crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
const problem = (code, message, cause) => Object.assign(new Error(message, { cause }), { code });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const validPayload = payload => object(payload) && object(payload.settings) && Array.isArray(payload.models)
  && object(payload.progress) && ['running', 'completed', 'failed'].includes(payload.progress.status)
  && payload.models.every(model => object(model) && typeof model.modelId === 'string' && Boolean(model.modelId))
  && new Set(payload.models.map(model => model.modelId)).size === payload.models.length;
const readExisting = async (checkpointPath, settingsFingerprint, maxBytes) => {
  let read;
  try { read = await readVerifiedContainedFile(path.dirname(checkpointPath), checkpointPath, { maxBytes }); }
  catch (error) {
    observeStorageResource(error, { phase: 'bakeoff-checkpoint-read' }).requireSettled();
    if (error.code === 'ENOENT') return { state: 'absent', payload: null, sourceHash: null };
    throw problem('ERR_BAKEOFF_CHECKPOINT_READ', 'Existing bakeoff checkpoint could not be admitted; it was preserved.', error);
  }
  let payload;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.buffer));
    if (!validPayload(payload)) throw new TypeError('Invalid checkpoint envelope.');
    const receipt = payload.benchmarkCheckpoint;
    if (receipt && (receipt.version !== BAKEOFF_CHECKPOINT_VERSION || receipt.kind !== 'embedding-model-bakeoff'
      || typeof receipt.runId !== 'string' || !/^[a-f0-9-]{36}$/u.test(receipt.runId)
      || !Number.isSafeInteger(receipt.revision) || receipt.revision < 1
      || receipt.settingsFingerprint !== hash(payload.settings))) throw new TypeError('Checkpoint publication identity does not match its settings.');
  } catch (error) { throw problem('ERR_BAKEOFF_CHECKPOINT_CORRUPT', 'Existing bakeoff checkpoint is malformed or inconsistent; it was preserved.', error); }
  const receiptPath = payload.benchmarkCheckpoint?.finalReceiptPath;
  const pathKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (typeof receiptPath === 'string' && pathKey(receiptPath) === pathKey(checkpointPath)) {
    throw problem('ERR_BAKEOFF_IMMUTABLE_CHECKPOINT_TARGET', 'A sealed final receipt cannot be a mutable checkpoint; import a copy at the selected checkpoint path.');
  }
  return { state: hash(payload.settings) === settingsFingerprint ? 'compatible' : 'incompatible-settings',
    payload, buffer: read.buffer, sourceHash: 'sha256:' + read.hash, sourceRunId: payload.benchmarkCheckpoint?.runId || null };
};

/** The existing file-lock owner fences this complete invocation, including
 * resume reads, all child phases and every checkpoint write. Unknown child or
 * persistence settlement keeps that original lock's release prerequisites. */
export const withBakeoffCheckpoint = async ({ root, checkpointPath, settings, signal,
  receiptRoot = path.join(root, '.testLogs', 'embedding-bakeoff'), maxBytes = BAKEOFF_CHECKPOINT_MAX_BYTES,
  writeOptions = {} }, worker) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > BAKEOFF_CHECKPOINT_MAX_BYTES) throw new TypeError('Private checkpoint allowance may only lower the fixed bound.');
  const settingsFingerprint = hash(settings);
  checkpointPath = path.resolve(checkpointPath);
  assertNoSymlinkPath(root, path.resolve(receiptRoot), { allowMissing: true });
  await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
  const owned = await withFileLock({ lockPath: checkpointPath + '.writer.lock', waitMs: 0,
    timeoutBehavior: 'null', signal, metadata: { scope: 'embedding-bakeoff-checkpoint',
      hostname: os.hostname(), resourceSettlementVersion: 1 } }, async () => {
    const { buffer, ...existing } = await readExisting(checkpointPath, settingsFingerprint, maxBytes);
    const evidence = await createBenchmarkEvidenceRun({ root, familyRoot: path.resolve(receiptRoot),
      family: 'embedding-model-bakeoff', signal, requiredBytes: 4 * maxBytes + BENCH_EVIDENCE_RECORD_BYTES + 65536 });
    const { runDir, runId } = evidence;
    const finalPath = path.join(runDir, 'final.json');
    let active = true, writing = null, revision = 0, sealed = false, latestPublished = false, primary, failed = false;
    let result, prerequisite = null;
    const pending = new Set(), writeFailures = [];
    const remember = error => { primary = failed && primary !== error
      ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : failed ? primary : error; failed = true; };
    try {
      if (buffer) {
        existing.sourceReceiptPath = path.join(runDir, 'resume-source.json');
        await evidence.writeText('resume-source.json', buffer);
      }
      Object.freeze(existing);
      await evidence.writeJson('owner.json', { version: BAKEOFF_CHECKPOINT_VERSION,
        kind: 'embedding-model-bakeoff', runId, startedAt: new Date().toISOString(), checkpointPath });
      const owner = Object.freeze({ runId, runDir, finalPath, existing,
        isSealed: () => sealed, hasPublished: () => latestPublished,
        write(payload, { final = false, publishLatest = true } = {}) {
          if (!active || sealed) return Promise.reject(problem('ERR_BAKEOFF_CHECKPOINT_OWNER_CLOSED', 'This checkpoint invocation no longer admits writes.'));
          if (writing) return Promise.reject(problem('ERR_BAKEOFF_CHECKPOINT_CONCURRENT_WRITE', 'A checkpoint publication is already pending.'));
          const operation = (async () => {
            if (!validPayload(payload) || hash(payload.settings) !== settingsFingerprint) throw problem('ERR_BAKEOFF_CHECKPOINT_IDENTITY', 'Checkpoint payload disagrees with its admitted settings or envelope.');
            if (final && !['completed', 'failed'].includes(payload.progress?.status) || !final && !publishLatest) {
              throw problem('ERR_BAKEOFF_CHECKPOINT_TERMINAL', 'Only a terminal report may be sealed without updating the latest checkpoint.');
            }
            const value = { ...payload, benchmarkCheckpoint: { version: BAKEOFF_CHECKPOINT_VERSION,
              kind: 'embedding-model-bakeoff', runId, revision: revision + 1, settingsFingerprint,
              previousRunId: existing.sourceRunId || null, checkpointPath,
              resumeSource: existing.sourceReceiptPath ? { path: existing.sourceReceiptPath, sha256: existing.sourceHash.slice(7) } : null,
              latestPublication: publishLatest ? 'requested' : 'not-requested', finalReceiptPath: final ? finalPath : null } };
            const text = JSON.stringify(value, null, 2) + '\n';
            if (Buffer.byteLength(text) > maxBytes) throw problem('ERR_BAKEOFF_CHECKPOINT_TOO_LARGE', 'Checkpoint exceeds its bounded report allowance.');
            // Either publication can issue paths retained outside this directory.
            // Pin before dispatch, including possibly completed failed writes.
            evidence.markReferenced();
            if (final) {
              await evidence.writeText('final.json', text, writeOptions);
              sealed = true;
            }
            try {
              if (publishLatest) { await evidence.trackExternal(() => atomicWriteText(checkpointPath, text, writeOptions)); latestPublished = true; }
            }
            catch (error) {
              if (!sealed) throw error;
              throw addStorageFailureContext(problem('ERR_BAKEOFF_LATEST_PUBLICATION', `Final receipt is preserved at ${finalPath}; latest checkpoint publication failed.`), {}, error, { secondaryPresent: true });
            }
            revision++;
            return value;
          })();
          writing = operation; pending.add(operation);
          operation.then(() => { writing = null; pending.delete(operation); }, error => {
            writing = null; pending.delete(operation); writeFailures.push(error);
          });
          return operation;
        }
      });
      result = await worker(owner);
      const original = observeStorageResource(result, { phase: 'bakeoff-checkpoint-worker-result' });
      if (original.hasResourceObservation) prerequisite = original.retain();
      original.requireSettled();
    } catch (error) { remember(error); }
    active = false;
    await Promise.allSettled([...pending]);
    for (const error of writeFailures) remember(error);
    try { await evidence.finish(prerequisite || (failed ? primary : result), { failed }); }
    catch (error) { remember(error); }
    if (failed) throw prerequisite ? addStorageFailureContext(primary, {}, prerequisite, { secondaryPresent: true }) : primary;
    // A successful worker can still own resources. Keep its captured original
    // prerequisite through accepted-write drain and actual checkpoint unlock.
    return prerequisite ? addStorageFailureContext(new Error('Original bakeoff worker prerequisites.'),
      { result }, prerequisite, { secondaryPresent: true }) : { result };
  });
  if (!owned) throw problem('ERR_BAKEOFF_CHECKPOINT_BUSY', 'Another invocation owns the selected bakeoff checkpoint.');
  return owned.result;
};
