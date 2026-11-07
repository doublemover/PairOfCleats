import path from 'node:path';
import net from 'node:net';
import { Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { finiteViewFields } from '../../../semantic/views/finite-input.js';
import { resolveManagedTypeScriptApi7Recipes, TYPESCRIPT_API7_PROFILE, TYPESCRIPT_API7_VERSION } from '../../../../shared/typescript-api7-pins.js';
import { retainManagedToolInstallation } from '../../../../shared/managed-installation.js';
import { resolveNoProvisionToolingEnvironment } from '../../../../shared/toolchain-env.js';
import { createStorageObservationLedger } from '../../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../../shared/storage/operation-error.js';
import { isStorageSessionReleaseFailure } from '../../../../shared/storage/session.js';
import { spawnSubprocess } from '../../../../shared/subprocess/runner.js';
import { trackedOwnershipIdByAbortSignal } from '../../../../shared/subprocess/tracking.js';
import { createRecordWriter, readRecords } from '../runtime/protocol.js';
import { api7Failure, api7Identity, captureTypeScriptApi7Request, TYPESCRIPT_API7_LIMITS, TYPESCRIPT_API7_FS_CALLBACKS } from './request.js';
import { captureTypeScriptApi7Result } from './result.js';
import { snapshotPlainData } from '../../../../shared/plain-data-snapshot.js';

const ENTRY = fileURLToPath(new URL('./worker.js', import.meta.url));
const MAX_MS = 25000;
const capturedBytesIntact = result => ['stdout', 'stderr'].every(name =>
  result.outputCapture?.[name]?.truncated !== true && result.outputCapture?.[name]?.encodingLoss !== true);

/** Experimental, explicit whole-request execution. SDK and native children have
 * independent original process owners. A completed SDK close is not native
 * process-close evidence. Both immutable installations stay leased until actual
 * child, bridge and independently observed resources settle. */
export const runTypeScriptApi7Request = async input => {
  const { toolingRoot, request: supplied, signal = null } = finiteViewFields(input, ['toolingRoot', 'request'], ['signal'], api7Failure);
  const request = captureTypeScriptApi7Request(supplied);
  if (!path.isAbsolute(toolingRoot || '') || signal !== null && !(signal instanceof AbortSignal)) throw api7Failure('invalid-execution-authority');
  const recipes = resolveManagedTypeScriptApi7Recipes();
  if (!recipes) throw Object.assign(api7Failure('unsupported-platform'), { code: 'ERR_TYPESCRIPT_API7_PLATFORM' });
  signal?.throwIfAborted();
  const started = Date.now(), aborter = new AbortController();
  const combined = signal ? AbortSignal.any([signal, aborter.signal]) : aborter.signal;
  const deadline = setTimeout(() => aborter.abort(api7Failure('deadline')), MAX_MS);
  const metadataFailures = new WeakSet();
  const ledger = createStorageObservationLedger({ isOwnFailure: value => metadataFailures.has(value) }), leases = [], tasks = [];
  let server, socket, inputPipe, outputPipe, nativeChild, candidate, firstError, released = false;
  let serverClosed = true, socketClosed = true, nativeClosed = true, workerClosed = true;
  let inputTask, outputTask, nativeResult, workerResult, resultSeen = false;
  const remember = value => { if (value !== undefined && value !== null) ledger.remember(value); return value; };
  const fail = error => { remember(error); firstError ||= error; aborter.abort(error); };
  const remaining = () => {
    combined.throwIfAborted(); const ms = MAX_MS - (Date.now() - started);
    if (ms <= 0) throw api7Failure('deadline'); return ms;
  };
  const wire = limit => new Transform({ transform(chunk, encoding, callback) {
    this.bytes = (this.bytes || 0) + chunk.length;
    if (this.bytes > limit) { const error = api7Failure('native-wire-byte-limit'); fail(error); callback(error); }
    else callback(null, chunk);
  } });
  const physicallyClosed = () => serverClosed && socketClosed && nativeClosed && workerClosed;
  const release = () => {
    if (released) return true;
    if (!physicallyClosed() || !ledger.isSettled()) throw api7Failure('original-resources-pending');
    for (const lease of [...leases].reverse()) {
      if (lease.released) continue;
      if (!ledger.isSettled()) throw api7Failure('original-resources-pending');
      try { if (remember(lease.owner.release()) !== true) throw api7Failure('installation-lease-pending'); lease.released = true; }
      catch (error) {
        if (isStorageSessionReleaseFailure(error, lease.owner.storageSession)) {
          metadataFailures.add(error);
          for (const original of error.errors) remember(original);
        }
        remember(error); throw error;
      }
    }
    if (!ledger.isSettled()) throw api7Failure('original-resources-pending');
    released = true; return true;
  };
  const recovery = Object.freeze({ releaseAfterClosure: release });
  try {
    const selected = {};
    for (const role of ['sdk', 'native']) {
      remaining(); const recipe = recipes[role], descriptorId = api7Identity(recipe.managedDescriptor);
      const owner = await retainManagedToolInstallation({ toolingRoot, toolId: recipe.managedDescriptor.toolId, descriptorId });
      remember(owner); leases.push({ owner, released: false }); remaining();
      if (owner.receipt.descriptorId !== descriptorId || api7Identity(owner.receipt.descriptor) !== descriptorId) throw api7Failure('component-pin-mismatch');
      selected[role] = owner;
    }
    const namespace = randomUUID().replaceAll('-', ''), virtualRoot = 'C:/__pairofcleats_api7__/' + namespace;
    const toolIdentity = Object.fromEntries(['sdk', 'native'].map(role => [role, { descriptorId: selected[role].receipt.descriptorId,
      installId: selected[role].receipt.installId }]));
    const pipe = '\\\\.\\pipe\\pairofcleats-api7-' + namespace;
    const env = resolveNoProvisionToolingEnvironment(process.env, { command: selected.native.command,
      providerId: TYPESCRIPT_API7_PROFILE, toolingRoot, cwd: toolingRoot });
    delete env.TS_API_TIMING_DIR; delete env.NODE_OPTIONS; delete env.NODE_PATH;
    inputPipe = wire(8 * 1024 * 1024); outputPipe = wire(16 * 1024 * 1024);
    for (const stream of [inputPipe, outputPipe]) stream.on('error', fail);
    server = net.createServer(connection => {
      if (socket) { connection.destroy(); fail(api7Failure('duplicate-api-connection')); return; }
      socket = connection; socketClosed = false;
      connection.on('error', fail);
      connection.once('close', () => { socketClosed = true; nativeChild?.stdin.end(); });
      connection.pipe(inputPipe).pipe(nativeChild.stdin);
      nativeChild.stdout.pipe(outputPipe).pipe(connection);
    });
    server.on('error', fail); server.once('close', () => { serverClosed = true; });
    serverClosed = false;
    await new Promise((resolve, reject) => {
      const failed = error => { serverClosed = true; reject(error); };
      server.once('error', failed); server.listen(pipe, () => { server.removeListener('error', failed); resolve(); });
    });
    remaining();
    const ownershipId = trackedOwnershipIdByAbortSignal.get(signal);
    const nativeTask = spawnSubprocess(selected.native.command, ['--api', '--async', '--cwd', virtualRoot,
      '--useCaseSensitiveFileNames=false', '--callbacks=' + TYPESCRIPT_API7_FS_CALLBACKS], {
      cwd: toolingRoot, env, stdio: ['pipe', 'pipe', 'pipe'], timeoutMs: remaining(), signal: combined,
      captureStdout: false, maxOutputBytes: 65536, killTree: true, killGraceMs: 0, cleanupOnParentExit: true,
      ownershipId, name: 'typescript-api7-native', onSpawn(child) {
        nativeChild = child; nativeClosed = false; child.once('close', () => { nativeClosed = true; });
        child.stdin.on('error', fail); child.stdout.on('error', fail);
      }
    }).then(value => { nativeResult = remember(value); }, fail);
    tasks.push(nativeTask);
    const workerTask = spawnSubprocess(process.execPath, ['--max-old-space-size=512', ENTRY], {
      cwd: toolingRoot, env, stdio: ['pipe', 'pipe', 'pipe'], timeoutMs: remaining(), signal: combined,
      captureStdout: false, maxOutputBytes: 65536, killTree: true, killGraceMs: 0, cleanupOnParentExit: true,
      ownershipId, name: 'typescript-api7-sdk', onSpawn(child) {
        workerClosed = false; child.once('close', () => { workerClosed = true; }); child.stdin.on('error', fail);
        inputTask = (async () => {
          const write = createRecordWriter(child.stdin, TYPESCRIPT_API7_LIMITS, TYPESCRIPT_API7_LIMITS.maxInputBytes);
          await write({ type: 'request', sdkRoot: selected.sdk.root, pipe, virtualRoot, request, toolIdentity }); child.stdin.end();
        })(); inputTask.catch(fail);
        outputTask = (async () => {
          for await (const record of readRecords(child.stdout, TYPESCRIPT_API7_LIMITS, TYPESCRIPT_API7_LIMITS.maxOutputBytes)) {
            if (resultSeen || record.type !== 'result' || Object.keys(record).sort().join(',') !== 'type,value' || !record.value) throw api7Failure('invalid-worker-output');
            resultSeen = true; candidate = record.value;
          }
        })(); outputTask.catch(fail);
      }
    }).then(value => { workerResult = remember(value); }, fail);
    tasks.push(workerTask);
    await workerTask;
    await Promise.allSettled([inputTask, outputTask]);
    // API.close destroys its socket; finish native input even if the socket's
    // close notification has not yet reached the bridge callback.
    nativeChild?.stdin.end();
    await nativeTask;
    if (firstError) throw firstError;
    if (!candidate || !capturedBytesIntact(nativeResult) || !capturedBytesIntact(workerResult)
      || nativeResult.stderr || workerResult.stderr) throw api7Failure('incomplete-or-diagnostic-child-output');
    candidate = captureTypeScriptApi7Result(candidate, { request, virtualRoot, toolIdentity });
    candidate = { ...candidate, runtime: { node: process.versions.node, abi: process.versions.modules, platform: process.platform, arch: process.arch },
      toolIdentity: { version: TYPESCRIPT_API7_VERSION,
        sdk: { descriptorId: selected.sdk.receipt.descriptorId, installId: selected.sdk.receipt.installId },
        native: { descriptorId: selected.native.receipt.descriptorId, installId: selected.native.receipt.installId } },
      lifecycle: { ...candidate.lifecycle, nativeExitCode: nativeResult.exitCode, sdkExitCode: workerResult.exitCode,
        nativeCloseObserved: nativeClosed, sdkCloseObserved: workerClosed },
      bounds: { deadlineMs: MAX_MS, nativeInputBytes: inputPipe.bytes || 0, nativeOutputBytes: outputPipe.bytes || 0,
        v8OldHeapMb: 512, nativeRssLimit: null } };
  } catch (error) { fail(error); }
  finally {
    if (firstError) aborter.abort(firstError);
    socket?.destroy(); inputPipe?.destroy(); outputPipe?.destroy();
    await Promise.allSettled(tasks);
    await Promise.allSettled([inputTask, outputTask]);
    if (server) await new Promise(resolve => {
      // Do not wait beyond the cleanup observation bound or infer closure from
      // its expiry. The original close listener remains the recovery witness.
      const timer = setTimeout(resolve, 500);
      server.close(error => {
        clearTimeout(timer); if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') fail(error); resolve();
      });
    });
    clearTimeout(deadline);
    try { release(); } catch (error) { remember(error); firstError = firstError ? addStorageFailureContext(firstError, {}, error,
      { secondaryPresent: true, forceAggregate: true, ownerMessage: 'TypeScript7.1 API closure failed.' }) : error; }
  }
  if (firstError) throw addStorageFailureContext(firstError, { typescriptApi7Session: recovery,
    cacheOwnershipPending: !released, cacheOwnershipReleased: () => released && physicallyClosed() && ledger.isSettled() }, undefined,
  { nonEnumerable: ['typescriptApi7Session'], forceAggregate: true, ownerMessage: 'TypeScript7.1 request failed; original closure owners are retained.' });
  return snapshotPlainData(candidate, { maxBytes: 8 * 1024 * 1024, maxDepth: 48, maxItems: 4096,
    label: 'TypeScript7.1 runtime receipt', code: 'ERR_TYPESCRIPT_API7', freeze: true, nullPrototype: false });
};
