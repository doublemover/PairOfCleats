import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteJson, atomicWriteText } from '../../src/shared/io/atomic-write.js';
import { assertDirectoryIdentity } from '../../src/shared/io/directory-sync.js';
import { persistenceFileIdentity, assertPersistenceFileIdentity } from '../../src/shared/io/file-identity.js';
import { readJsonResourceTextSync, readFileResourceBytesSync } from '../../src/shared/file-read-resource.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { createStorageObservationLedger } from '../../src/shared/storage/failure-observation.js';
import { readErrorDataProperty } from '../../src/shared/error-data.js';
import { requireCheckoutMutationSession, withCheckoutMutation } from './checkout-mutation.js';
import { BOOTSTRAP_RECEIPT } from './checkout-bootstrap-paths.js';
import { getCheckoutEvidenceFiles, captureCheckoutEvidenceIO } from './checkout-evidence-files.js';
import { publishEvidenceJson } from './checkout-evidence-records.js';
import { prepareCheckoutEvidenceRetention, publishCheckoutEvidenceManifest } from './checkout-evidence-retention.js';

export const CHECKOUT_JOURNAL_VERSION = 1;
export const CHECKOUT_JOURNAL_STATUS = '.tmp/checkout-bootstrap/journal-status.json';
export const CHECKOUT_JOURNAL_LIMITS = Object.freeze({ stages: 16, events: 128, bytes: 256 * 1024, planBytes: 64 * 1024,
  priorReceiptBytes: 8 * 1024 * 1024 });
const journals = new WeakMap(), admissions = new WeakMap();
const failure = message => Object.assign(new Error(message), { code: 'ERR_CHECKOUT_BOOTSTRAP_JOURNAL' });
const ownText = (value, field, max = 1024) => {
  const text = readErrorDataProperty(value, field); return typeof text === 'string' ? text.slice(0, max) : null;
};
const projectedFailure = error => Object.freeze({ type: error === null ? 'null' : typeof error,
  code: ownText(error, 'code', 128), message: ownText(error, 'message'),
  ...(['boolean', 'number', 'string'].includes(typeof error) ? { value: typeof error === 'string' ? error.slice(0, 1024) : error } : {}) });

/** An in-process original owner, not a serialized resume/deletion capability. */
export const getCheckoutStageJournal = session => session && journals.get(session)?.journal || null;

/** Read-only evidence inspection. These records never authorize stage replay,
 * native retirement, lock stealing or deletion of a prior run's artifacts.
 */
export const readCheckoutJournalStatus = root => {
  const statusFile = path.join(root, CHECKOUT_JOURNAL_STATUS);
  let stat;
  try { stat = fs.lstatSync(statusFile, { bigint: true }); }
  catch (error) { if (readErrorDataProperty(error, 'code') === 'ENOENT') return null; throw error; }
  const identity = persistenceFileIdentity(stat);
  const text = readJsonResourceTextSync(statusFile, actual => {
    if (actual.size > CHECKOUT_JOURNAL_LIMITS.bytes) throw failure('Checkout status exceeds its read bound.');
  }, actual => assertPersistenceFileIdentity(actual, identity));
  assertPersistenceFileIdentity(fs.lstatSync(statusFile, { bigint: true }), identity);
  const record = JSON.parse(text);
  if (record?.schemaVersion !== CHECKOUT_JOURNAL_VERSION || record.kind !== 'checkout-bootstrap-stage-journal'
    || record.root !== fs.realpathSync(root) || typeof record.runId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(record.runId)
    || typeof record.planId !== 'string' || !/^[a-f0-9]{64}$/.test(record.planId)
    || !['running', 'failed', 'completed'].includes(record.state) || !Array.isArray(record.stages)
    || record.stages.length > CHECKOUT_JOURNAL_LIMITS.stages) throw failure('Checkout status has an unsupported or invalid identity.');
  if (record.state === 'completed') {
    const selected = record.selectedPlan?.stages, file = record.file;
    if (!Array.isArray(selected) || !selected.length || selected.length > CHECKOUT_JOURNAL_LIMITS.stages
      || selected.some(stage => typeof stage?.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,96}$/.test(stage.id))
      || new Set(selected.map(stage => stage.id)).size !== selected.length
      || createHash('sha256').update(JSON.stringify(record.selectedPlan)).digest('hex') !== record.planId
      || selected.length !== record.stages.length
      || record.stages.some((row, index) => row.id !== selected[index]?.id || row.state !== 'succeeded')
      || record.originalResources !== 'retired' || file?.complete !== true
      || typeof file.path !== 'string' || !/^\.tmp\/checkout-bootstrap\/j-[a-zA-Z0-9_-]{6,32}\/stages\.jsonl$/.test(file.path)
      || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > CHECKOUT_JOURNAL_LIMITS.bytes
      || !Number.isSafeInteger(file.events) || file.events < 1 || file.events > CHECKOUT_JOURNAL_LIMITS.events
      || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw failure('Completed checkout status lacks its original complete stage evidence.');
    let parent = root;
    for (const part of file.path.split('/').slice(0, -1)) {
      parent = path.join(parent, part); const actual = fs.lstatSync(parent);
      if (!actual.isDirectory() || actual.isSymbolicLink()) throw failure('Checkout journal reads require regular owned directories.');
    }
    const target = path.join(root, ...file.path.split('/')), sealed = persistenceFileIdentity(fs.lstatSync(target, { bigint: true }));
    const contents = readJsonResourceTextSync(target, actual => {
      if (actual.size !== file.bytes) throw failure('Checkout journal extent differs from its completed status.');
    }, actual => assertPersistenceFileIdentity(actual, sealed));
    assertPersistenceFileIdentity(fs.lstatSync(target, { bigint: true }), sealed);
    if (createHash('sha256').update(contents).digest('hex') !== file.sha256) throw failure('Checkout journal bytes differ from its completed status.');
    if (!contents.endsWith('\n')) throw failure('Completed checkout journal has an incomplete final frame.');
    const events = contents.slice(0, -1).split('\n').map(line => JSON.parse(line));
    if (events.length !== file.events || events.length !== 2 + selected.length * 2
      || events.some((event, index) => event.schemaVersion !== CHECKOUT_JOURNAL_VERSION || event.sequence !== index + 1
        || event.runId !== record.runId || event.planId !== record.planId)
      || events[0].state !== 'run-started' || events.at(-1).state !== 'run-completed'
      || createHash('sha256').update(JSON.stringify(events[0].plan)).digest('hex') !== record.planId
      || selected.some((stage, index) => events[1 + index * 2].state !== 'stage-started'
        || events[1 + index * 2].stageId !== stage.id || events[2 + index * 2].state !== 'stage-finished'
        || events[2 + index * 2].stageId !== stage.id || events[2 + index * 2].outcome?.state !== 'succeeded')) throw failure(
      'Completed checkout journal does not contain its exact ordered original stage frames.');
  }
  return record;
};

const capturePlan = plan => {
  const serializedPlan = JSON.stringify(plan);
  if (typeof serializedPlan !== 'string' || Buffer.byteLength(serializedPlan) > CHECKOUT_JOURNAL_LIMITS.planBytes) throw failure('Checkout plan exceeds its journal byte bound.');
  const captured = JSON.parse(serializedPlan), stages = captured?.stages;
  const pendingObjects = [captured]; let objects = 0;
  while (pendingObjects.length) {
    const value = pendingObjects.pop();
    if (!value || typeof value !== 'object') continue;
    if (++objects > 4096) throw failure('Checkout plan exceeds its object bound.');
    pendingObjects.push(...Object.values(value)); Object.freeze(value);
  }
  if (!Array.isArray(stages) || !stages.length || stages.length > CHECKOUT_JOURNAL_LIMITS.stages
    || stages.some(stage => typeof stage.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,96}$/.test(stage.id))
    || new Set(stages.map(stage => stage.id)).size !== stages.length) throw failure('Checkout journal requires a bounded ordered stage plan.');
  return Object.freeze({ serializedPlan, captured, stages });
};

const createJournal = (root, session, { serializedPlan, captured, stages }, { io, publish }, retention) => {
  requireCheckoutMutationSession(root, session); root = session.root;
  const started = Promise.withResolvers();
  // Its owner still receives the exact startup rejection; this observation
  // prevents an unused admission gate from becoming an unhandled promise.
  started.promise.catch(() => {});
  const parent = path.join(root, '.tmp', 'checkout-bootstrap'), directory = fs.mkdtempSync(path.join(parent, 'j-'));
  const directoryIdentity = fs.lstatSync(directory, { bigint: true }); assertDirectoryIdentity(directoryIdentity);
  const file = path.join(directory, 'stages.jsonl'), statusFile = path.join(root, CHECKOUT_JOURNAL_STATUS);
  const evidence = getCheckoutEvidenceFiles(root, session), owner = evidence.open(file, { io });
  let initialIdentity = null;
  const hash = createHash('sha256'), startedAt = Date.now(), outcomes = [], observations = createStorageObservationLedger();
  const pendingWork = new Set(), observedFailures = [];
  const remember = error => {
    observations.remember(error);
    if (observedFailures.length < 128) observedFailures.push(error); else observations.markIncomplete();
  };
  const track = operation => {
    if (pendingWork.size >= 128) return Promise.reject(failure('Checkout journal has too much outstanding original work.'));
    const pending = withCheckoutMutation(root, operation, { session }); pendingWork.add(pending);
    pending.then(() => pendingWork.delete(pending), error => { pendingWork.delete(pending); remember(error); });
    return pending;
  };
  const planId = createHash('sha256').update(serializedPlan).digest('hex');
  let bytes = 0, sequence = 0, activeStage = null, accepting = true, closed = false, generationId = null, lastMetadata = null, priorReadiness = null,
    appendFailed = false, stageFailed = false, fileVerified = false, runError = null;
  const check = () => {
    requireCheckoutMutationSession(root, session);
    assertDirectoryIdentity(fs.lstatSync(directory, { bigint: true }), directoryIdentity);
  };
  const append = event => {
    check(); if (closed || appendFailed) throw failure('Checkout journal no longer admits stage observations.');
    const original = owner.operations.stat({ bigint: true });
    if (original.size !== BigInt(bytes)) throw failure('Checkout journal extent changed before its next observation.');
    assertPersistenceFileIdentity(fs.lstatSync(file, { bigint: true }), persistenceFileIdentity(original));
    const row = Object.freeze({ schemaVersion: CHECKOUT_JOURNAL_VERSION, runId: session.runId, planId,
      sequence: sequence + 1, timestamp: Date.now(), ...event });
    const data = Buffer.from(JSON.stringify(row) + '\n');
    if (sequence >= CHECKOUT_JOURNAL_LIMITS.events || bytes + data.length > CHECKOUT_JOURNAL_LIMITS.bytes) throw failure('Checkout stage journal exhausted its finite event/byte budget.');
    let offset = 0;
    try { while (offset < data.length) {
      const count = owner.operations.write(data, offset, data.length - offset, null);
      if (!Number.isSafeInteger(count) || count < 0 || count > data.length - offset) {
        const unknown = Object.assign(failure('Checkout journal write returned unknown original operation evidence.'), { cacheOwnershipPending: true });
        owner.remember(unknown); throw unknown;
      }
      if (count === 0) throw failure('Checkout journal write did not confirm exact progress.');
      hash.update(data.subarray(offset, offset + count)); bytes += count; offset += count;
    } } catch (error) { appendFailed = true; throw error; }
    sequence++; return row;
  };
  const metadata = state => Object.freeze({ schemaVersion: CHECKOUT_JOURNAL_VERSION, kind: 'checkout-bootstrap-stage-journal', root,
    runId: session.runId, planId, inputId: typeof captured.inputId === 'string' ? captured.inputId : null,
    state, startedAt, finishedAt: state === 'running' ? null : Date.now(), generationId, error: runError, priorReadiness, retention,
    originalResources: owner.isSettled() && observations.isSettled() && evidence.isSettled() ? 'retired' : 'pending',
    stages: Object.freeze([...outcomes]), file: Object.freeze({ path: path.relative(root, file).replaceAll('\\', '/'), bytes,
      events: sequence, sha256: hash.copy().digest('hex'), complete: fileVerified }), selectedPlan: captured });
  const persist = async state => {
    const record = metadata(state);
    const expectedText = JSON.stringify(record), expectedBytes = Buffer.byteLength(expectedText);
    if (expectedBytes > CHECKOUT_JOURNAL_LIMITS.bytes) throw failure('Checkout status metadata exceeds its byte bound.');
    const publicationCheck = () => { check(); if (state === 'completed') evidence.requireSettled(); };
    publicationCheck();
    const actual = await publish(statusFile, record, { mkdir: false, spaces: 0, newline: false, durable: true, beforeCommit: publicationCheck });
    if (typeof actual !== 'string' || path.resolve(actual) !== path.resolve(statusFile)) throw failure('Checkout journal publication did not confirm its original status path.');
    const identity = persistenceFileIdentity(fs.lstatSync(statusFile, { bigint: true }));
    const text = readJsonResourceTextSync(statusFile, stat => {
      if (stat.size !== expectedBytes) throw failure('Checkout status has a different original byte extent.');
    }, stat => assertPersistenceFileIdentity(stat, identity));
    publicationCheck(); assertPersistenceFileIdentity(fs.lstatSync(statusFile, { bigint: true }), identity);
    if (text !== expectedText) throw failure('Checkout status differs from its original published record.');
    lastMetadata = Object.freeze(record); return record;
  };
  const journal = Object.freeze({ root, runId: session.runId, planId, file, statusFile,
    snapshot: () => lastMetadata,
    bindVerifiedGeneration: value => {
      check(); if (!accepting || closed || typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw failure('Checkout verification requires its original active journal and exact generation identity.');
      if (generationId && generationId !== value) throw failure('Checkout journal already identifies a different verified generation.');
      generationId = value;
    },
    runStage: (id, action) => track(async () => {
      check(); if (!accepting || closed || activeStage || stageFailed || stages[outcomes.length]?.id !== id || typeof action !== 'function') throw failure('Checkout stages must execute exactly once in their admitted order.');
      activeStage = id;
      const began = append({ state: 'stage-started', stageId: id });
      let result, primary, failed = false;
      try { result = await action(); }
      catch (error) { primary = error; failed = true; observations.remember(error); }
      const logicalFailure = !failed && readErrorDataProperty(result, 'ok') === false;
      if (failed || logicalFailure) stageFailed = true;
      const terminal = failed ? readErrorDataProperty(primary, 'childResult') : result;
      const resultOk = readErrorDataProperty(result, 'ok'), resultStatus = readErrorDataProperty(terminal, 'status') ?? readErrorDataProperty(terminal, 'exitCode'),
        resultSignal = readErrorDataProperty(terminal, 'signal');
      const row = Object.freeze({ id, state: failed || logicalFailure ? 'failed' : 'succeeded', startedAt: began.timestamp,
        finishedAt: Date.now(), result: Object.freeze({ ok: typeof resultOk === 'boolean' ? resultOk : null,
          status: Number.isInteger(resultStatus) ? resultStatus : null, signal: typeof resultSignal === 'string' ? resultSignal.slice(0, 64) : null,
          diagnosticsPath: ownText(result, 'diagnosticsPath', 4096) }),
        error: failed ? projectedFailure(primary) : null, originalResources: observations.isSettled() ? 'retired' : 'pending' });
      outcomes.push(row);
      try { append({ state: 'stage-finished', stageId: id, outcome: row }); await persist('running'); }
      catch (error) {
        stageFailed = true;
        throw failed ? addStorageFailureContext(primary, { checkoutJournal: file }, error, { secondaryPresent: true })
          : addStorageFailureContext(error, { checkoutJournal: file, checkoutStageResult: result });
      } finally { activeStage = null; }
      if (failed) throw primary;
      return result;
    })
  });
  const finish = async (primary, failed) => {
    let failureValue = primary, hasFailure = failed;
    try { observations.requireSettled(); }
    catch (pending) {
      if (!hasFailure && observedFailures.length) { failureValue = observedFailures[0]; hasFailure = true; }
      failureValue = hasFailure ? addStorageFailureContext(failureValue, { checkoutJournal: file }, pending, { secondaryPresent: true }) : pending;
      hasFailure = true;
    }
    try { evidence.requireOtherResourcesSettled(owner); }
    catch (error) {
      failureValue = hasFailure ? addStorageFailureContext(failureValue, { checkoutJournal: file }, error, { secondaryPresent: true }) : error;
      hasFailure = true;
    }
    try {
      if (!hasFailure && (activeStage || outcomes.length !== stages.length || outcomes.some(row => row.state !== 'succeeded'))) throw failure('Checkout journal cannot complete an unfinished or unsuccessful plan.');
      append({ state: hasFailure ? 'run-failed' : 'run-completed', error: hasFailure ? projectedFailure(failureValue) : null });
    } catch (error) {
      failureValue = hasFailure ? addStorageFailureContext(failureValue, { checkoutJournal: file }, error, { secondaryPresent: true }) : error;
      hasFailure = true;
    }
    try { owner.runSync(descriptor => {
      if (descriptor.sync() !== undefined) throw failure('Checkout journal synchronization did not confirm its standard void result.');
      const stat = descriptor.stat({ bigint: true }), identity = persistenceFileIdentity(stat);
      if (!initialIdentity || identity.dev !== initialIdentity.dev || identity.ino !== initialIdentity.ino || stat.size !== BigInt(bytes)) throw failure('Checkout journal changed outside its original writer.');
      assertPersistenceFileIdentity(fs.lstatSync(file, { bigint: true }), identity);
    }); } catch (error) {
      failureValue = hasFailure ? addStorageFailureContext(failureValue, { checkoutJournal: file }, error, { secondaryPresent: true }) : error;
      hasFailure = true;
    }
    closed = true;
    if (owner.isSettled() && !appendFailed && initialIdentity) {
      try {
        const identity = persistenceFileIdentity(fs.lstatSync(file, { bigint: true }));
        if (['dev', 'ino', 'birthtime'].some(key => identity[key] !== initialIdentity[key])) throw failure('Checkout journal original file changed at close.');
        const text = readJsonResourceTextSync(file, stat => {
          if (stat.size !== bytes || stat.size > CHECKOUT_JOURNAL_LIMITS.bytes) throw failure('Checkout journal closed byte extent changed.');
        }, stat => assertPersistenceFileIdentity(stat, identity));
        check(); assertPersistenceFileIdentity(fs.lstatSync(file, { bigint: true }), identity);
        if (createHash('sha256').update(text).digest('hex') !== hash.copy().digest('hex')) throw failure('Checkout journal differs from its original observation bytes.');
        evidence.sealClosed(file, { bytes, sha256: hash.copy().digest('hex') });
        fileVerified = true;
      } catch (error) {
        failureValue = hasFailure ? addStorageFailureContext(failureValue, { checkoutJournal: file }, error, { secondaryPresent: true }) : error;
        hasFailure = true;
      }
    }
    try { evidence.requireSettled(); }
    catch (error) {
      failureValue = hasFailure ? addStorageFailureContext(failureValue, { checkoutJournal: file }, error, { secondaryPresent: true }) : error;
      hasFailure = true;
    }
    runError = hasFailure ? projectedFailure(failureValue) : null;
    if (evidence.isSettled() && fileVerified) {
      try {
        const state = hasFailure ? 'failed' : 'completed';
        const result = await publishEvidenceJson(root, session, path.relative(root, path.join(directory, 'result.json')).replaceAll('\\', '/'), metadata(state), CHECKOUT_JOURNAL_LIMITS.bytes);
        evidence.registerPublished(path.join(root, result.path), result);
        await publishCheckoutEvidenceManifest(root, session, directory, state);
      } catch (error) {
        failureValue = hasFailure ? addStorageFailureContext(failureValue, { checkoutJournal: file }, error, { secondaryPresent: true }) : error;
        hasFailure = true; runError = projectedFailure(failureValue);
      }
    }
    try { await persist(hasFailure ? 'failed' : 'completed'); }
    catch (error) {
      failureValue = hasFailure ? addStorageFailureContext(failureValue, { checkoutJournal: file }, error, { secondaryPresent: true }) : error;
      hasFailure = true;
    }
    if (hasFailure) throw failureValue;
  };
  return { journal, finish, stopAdmission: () => { accepting = false; }, hasPendingWork: () => pendingWork.size > 0,
    drain: () => Promise.allSettled([...pendingWork]), borrow: operation => {
      check(); if (!accepting || closed) return Promise.reject(failure('Checkout journal no longer admits borrowed work.'));
      return track(async () => {
        await started.promise; check();
        if (!accepting || closed) throw failure('Checkout journal no longer admits borrowed work.');
        return operation(journal, false);
      });
    },
    start: async () => {
      try {
        initialIdentity = persistenceFileIdentity(owner.operations.stat({ bigint: true }));
        const previous = path.join(root, BOOTSTRAP_RECEIPT);
        let stat;
        try { stat = fs.lstatSync(previous, { bigint: true }); }
        catch (error) { if (readErrorDataProperty(error, 'code') !== 'ENOENT') throw error; }
        if (stat) {
          const parent = fs.lstatSync(path.dirname(previous));
          if (!parent.isDirectory() || parent.isSymbolicLink()) throw failure('Prior readiness preservation requires an ordinary dependency directory.');
          const original = persistenceFileIdentity(stat), admit = actual => {
            if (actual.size > CHECKOUT_JOURNAL_LIMITS.priorReceiptBytes) throw failure('Prior readiness exceeds its preservation byte bound.');
          };
          const data = readFileResourceBytesSync(previous, admit, actual => assertPersistenceFileIdentity(actual, original));
          assertPersistenceFileIdentity(fs.lstatSync(previous, { bigint: true }), original);
          const target = path.join(directory, 'prior-readiness.json');
          const actual = await atomicWriteText(target, data, { mkdir: false, mode: 0o600, beforeCommit: () => {
            check(); assertPersistenceFileIdentity(fs.lstatSync(previous, { bigint: true }), original);
          } });
          if (actual !== target) throw failure('Prior readiness preservation did not confirm its original destination.');
          const sealed = persistenceFileIdentity(fs.lstatSync(target, { bigint: true }));
          const copied = readFileResourceBytesSync(target, admit, actual => assertPersistenceFileIdentity(actual, sealed));
          assertPersistenceFileIdentity(fs.lstatSync(target, { bigint: true }), sealed);
          if (!copied.equals(data)) throw failure('Preserved prior readiness differs from its exact original bytes.');
          priorReadiness = Object.freeze({ state: 'historical-only-not-current-readiness',
            path: path.relative(root, target).replaceAll('\\', '/'), bytes: data.length,
            sha256: createHash('sha256').update(data).digest('hex'), source: BOOTSTRAP_RECEIPT });
          evidence.registerPublished(target, { bytes: data.length, sha256: priorReadiness.sha256 });
        }
        append({ state: 'run-started', plan: captured }); await persist('running'); started.resolve();
      } catch (error) { started.reject(error); throw error; }
    } };
};

/** Nested mutators share their caller's original journal; only its owner closes
 * the descriptor and publishes the terminal stage evidence. No stage is skipped
 * because an old serialized record says it previously completed.
 */
export const withCheckoutStageJournal = async (root, session, plan, operation, options = {}) => {
  requireCheckoutMutationSession(root, session);
  if (typeof operation !== 'function') throw new TypeError('Checkout journal requires its original operation callback.');
  const borrowed = journals.get(session);
  if (borrowed) return borrowed.borrow(operation);
  const capturedPlan = capturePlan(plan), { io = fs, publish = atomicWriteJson } = options;
  if (typeof publish !== 'function') throw new TypeError('Checkout journal requires its original publication callback.');
  const capturedOptions = Object.freeze({ io: captureCheckoutEvidenceIO(io), publish });
  return withCheckoutMutation(root, async () => {
    // A concurrent original caller may have installed the owner while this
    // borrowed mutation admission was waiting for its microtask.
    const admitted = journals.get(session);
    if (admitted) return admitted.borrow(operation);
    const queued = admissions.get(session);
    if (queued) return (await queued).borrow(operation);
    const ready = Promise.withResolvers(); ready.promise.catch(() => {}); admissions.set(session, ready.promise);
    let owner;
    try {
      const retention = await prepareCheckoutEvidenceRetention(root, session);
      owner = createJournal(root, session, capturedPlan, capturedOptions, retention);
      ready.resolve(owner);
    } catch (error) { ready.reject(error); throw error; }
    journals.set(session, owner);
    let result, primary, failed = false, operationStarted = false;
    try { await owner.start(); operationStarted = true; result = await operation(owner.journal, true); }
    catch (error) { primary = error; failed = true; }
    owner.stopAdmission();
    if (owner.hasPendingWork()) {
      if (operationStarted) {
        const unawaited = failure('Checkout journal returned with outstanding original stage or borrowed work.');
        primary = failed ? addStorageFailureContext(primary, { checkoutJournal: owner.journal.file }, unawaited, { secondaryPresent: true }) : unawaited;
        failed = true;
      }
      for (const result of await owner.drain()) if (result.status === 'rejected' && result.reason !== primary) {
        primary = failed ? addStorageFailureContext(primary, {}, result.reason, { secondaryPresent: true }) : result.reason; failed = true;
      }
    }
    try { await owner.finish(primary, failed); }
    finally { journals.delete(session); }
    return result;
  }, { session });
};
