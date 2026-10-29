import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { sha256FileObservation } from '../../src/shared/hash.js';
import { atomicWriteJson, atomicWriteText } from '../../src/shared/io/atomic-write.js';
import { acquireStorageWriteReservation } from '../../src/shared/storage/admission.js';
import { withStorageDirectory } from '../../src/shared/storage/directory.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';
import { inspectWindowsMinidump, WINDOWS_MINIDUMP_MAX_BYTES } from './windows-minidump.js';
import { WINDOWS_CDB_CHILD_CONTEXT, WINDOWS_CDB_COMMANDS, WINDOWS_CDB_CHILD_PHASES, WINDOWS_CDB_OUTPUT_BYTES as OUTPUT_BYTES } from './windows-cdb-protocol.js';

const ATTEMPT_BYTES = 24 * 1024 * 1024;
const FAMILY_BYTES = 128 * 1024 * 1024;
const fail = (reason, fields = {}) => Object.assign(new Error(`Windows CDB capture failed: ${reason}`), {
  code: 'ERR_WINDOWS_CDB_CAPTURE', reason, ...fields
});
const sha256 = value => createHash('sha256').update(value).digest('hex');

const inventory = async directory => withStorageDirectory(directory, async reader => {
  const files = [], observations = []; let bytes = 0;
  for (;;) {
    const entry = await reader.read(); if (!entry) break;
    if (files.length >= 64 || !entry.isFile()) throw fail('unexpected-attempt-entry');
    const file = path.join(directory, entry.name);
    assertNoSymlinkPath(directory, file);
    const stat = await fs.lstat(file, { bigint: true });
    const observation = observeStorageResource(stat, { phase: 'windows-cdb-inventory-stat' });
    observations.push(observation); observation.requireSettled();
    if (!stat.isFile() || stat.nlink !== 1n || stat.size < 0n || stat.size > BigInt(ATTEMPT_BYTES)) throw fail('unowned-or-oversize-attempt-file');
    bytes += Number(stat.size); if (bytes > ATTEMPT_BYTES) throw fail('attempt-byte-budget');
    files.push(Object.freeze({ name: entry.name, bytes: Number(stat.size) }));
    observation.requireSettled();
  }
  return Object.freeze({ bytes, files: Object.freeze(files),
    cacheOwnershipReleased: () => observations.every(observation => observation.isSettled()) });
});

export const runWindowsCdbCapture = async (config, options, retainFailure) => {
  const resourceId = randomUUID(), token = randomUUID(), observations = [];
  const remember = (value, phase) => {
    const observation = observeStorageResource(value, { phase: `windows-cdb-${phase}` });
    observations.push(observation); observation.requireSettled(); return value;
  };
  const requireOriginals = () => { for (const observation of observations) observation.requireSettled(); };
  const combine = (primary, secondary) => primary === null || primary === secondary ? secondary
    : addStorageFailureContext(primary, {}, secondary, { secondaryPresent: true, forceAggregate: true });
  let reservation = null, directory = null, failure = null, result = null, timer = null, poll = null, polling = false;
  let processResult = null, processFailure = null, monitorFailure = null, released = false, releasing = null;
  const releaseMetadata = async () => {
    requireOriginals();
    if (released || !reservation) return true;
    if (!releasing) releasing = (async () => {
      const response = await reservation.releaseAfterSettlement({ resourceId, settled: true, pending: false });
      remember(response, 'reservation-release'); released = true; return true;
    })().finally(() => { releasing = null; });
    return releasing;
  };
  const session = Object.freeze({ resourceId, releaseMetadata });
  const before = [];
  try {
    for (const file of [config.debuggerPath, process.execPath, ...config.nativeInputs]) {
      // Read-only installed runtime aliases (including nvm4w's Node junction)
      // resolve once. Hash and launch the physical executable, never the alias.
      const physical = remember(await fs.realpath(file), 'runtime-path');
      assertNoSymlinkPath(path.parse(physical).root, physical);
      const stat = remember(await fs.lstat(physical, { bigint: true }), 'runtime-stat');
      if (!stat.isFile() || stat.nlink !== 1n || stat.size > 512n * 1024n * 1024n) throw fail('invalid-runtime-input');
      const observed = remember(await sha256FileObservation(physical, { containedRoot: path.parse(physical).root }), 'input-hash');
      before.push(Object.freeze({ requestedPath: file, path: physical, sha256: observed.value, bytes: observed.bytes, fileIdentity: observed.fileIdentity }));
    }
    assertNoSymlinkPath(path.parse(config.captureRoot).root, config.captureRoot, { allowMissing: true });
    const symbols = [];
    for (const input of config.symbolDirectories) {
      const physical = remember(await fs.realpath(input), 'symbol-path');
      assertNoSymlinkPath(path.parse(physical).root, physical);
      const stat = remember(await fs.lstat(physical, { bigint: true }), 'symbol-stat');
      if (!stat.isDirectory() || /[;*]/u.test(physical)) throw fail('invalid-local-symbol-directory');
      symbols.push(physical);
    }
    reservation = await acquireStorageWriteReservation({ root: config.captureRoot, resourceId,
      coordinationRoot: path.join(config.captureRoot, '.capture-control'), authorizedRoots: [config.captureRoot],
      requiredBytes: ATTEMPT_BYTES, hardBytes: FAMILY_BYTES, maxEntries: 4096, maxDurationMs: 2000 });
    remember(reservation, 'reservation-admission');
    remember(await fs.mkdir(config.captureRoot, { recursive: true }), 'family-create');
    directory = remember(await fs.mkdtemp(path.join(config.captureRoot, 'cdb-')), 'attempt-create');
    assertNoSymlinkPath(config.captureRoot, directory);
    remember(await atomicWriteText(path.join(directory, 'application.mjs'), options.script), 'application-write');
    const entry = `import { runWindowsCdbChild } from ${JSON.stringify(new URL('./windows-cdb-child.js', import.meta.url).href)};\nawait runWindowsCdbChild();\n`;
    remember(await atomicWriteText(path.join(directory, 'entry.mjs'), entry), 'entry-write');
    remember(await atomicWriteText(path.join(directory, 'commands.txt'), WINDOWS_CDB_COMMANDS), 'commands-write');
    const args = ['-o', '-g', '-G', '-noshell', '-nosqm', '-sins', '-netsyms:no', '-failinc', '-ses',
      '-y', [directory, ...symbols].join(';'), '-cf', path.join(directory, 'commands.txt'), before[1].path, path.join(directory, 'entry.mjs')];
    const env = { ...options.env, [WINDOWS_CDB_CHILD_CONTEXT]: JSON.stringify({ token, directory, cwd: options.cwd }) };
    const environment = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined).map(
      ([key, value]) => {
        if (typeof value !== 'string') throw fail('non-string-child-environment');
        return [key, sha256(value)];
      }));
    if (Buffer.byteLength(JSON.stringify(environment)) > 128 * 1024) throw fail('environment-record-extent');
    remember(await atomicWriteJson(path.join(directory, 'attempt.json'), {
      schemaVersion: 1, kind: 'windows-cdb-minidump-attempt', resourceId, token, createdAt: new Date().toISOString(),
      command: before[0].path, args, cwd: directory, applicationCwd: options.cwd, environmentValueHashes: environment,
      inputs: before, symbolDirectories: symbols, symbolQualification: 'codeview-identity-recorded-matching-symbols-unqualified',
      byteBudget: { attempt: ATTEMPT_BYTES, family: FAMILY_BYTES, minidump: WINDOWS_MINIDUMP_MAX_BYTES,
        enforcement: 'cooperative-admission-and-sampled-growth-abort' }, nativeQualification: 'pending'
    }), 'attempt-write');
    const controller = new AbortController();
    polling = true;
    timer = setInterval(() => {
      if (!polling || poll) return;
      poll = inventory(directory).then(value => { remember(value, 'monitor-inventory'); }).catch(error => {
        monitorFailure = error; observations.push(observeStorageResource(error, { phase: 'windows-cdb-monitor' })); controller.abort();
      }).finally(() => { poll = null; });
    }, 25);
    try {
      processResult = await (config.testRunDebugger || spawnSubprocess)(before[0].path, args, {
        cwd: directory, env, timeoutMs: config.timeoutMs, signal: controller.signal, killTree: true, detached: false,
        maxOutputBytes: OUTPUT_BYTES, outputMode: 'string', captureStdout: true, captureStderr: true,
        rejectOnNonZeroExit: false, name: 'windows-cdb-minidump', cleanupScope: resourceId
      });
      remember(processResult, 'original-debugger-result');
    } catch (error) { processFailure = error; observations.push(observeStorageResource(error, { phase: 'windows-cdb-original-debugger-error' })); }
    finally {
      polling = false; clearInterval(timer); timer = null;
      if (poll) await poll;
    }
    requireOriginals();
    const finalInventory = remember(await inventory(directory), 'final-inventory');
    const debugOutput = processResult || processFailure?.result;
    if (typeof debugOutput?.stdout === 'string') remember(await atomicWriteText(path.join(directory, 'debugger-stdout.txt'), debugOutput.stdout), 'debugger-stdout-write');
    if (typeof debugOutput?.stderr === 'string') remember(await atomicWriteText(path.join(directory, 'debugger-stderr.txt'), debugOutput.stderr), 'debugger-stderr-write');
    const read = async (name, maxBytes) => remember(await readVerifiedContainedFile(directory, path.join(directory, name), { maxBytes }), 'evidence-read');
    const readJson = async name => JSON.parse((await read(name, 65536)).buffer.toString('utf8'));
    const launch = await readJson('child-launch.json');
    if (launch.schemaVersion !== 1 || launch.token !== token || !Number.isSafeInteger(launch.pid) || launch.pid <= 0
      || launch.platform !== 'win32' || launch.arch !== 'x64' || launch.node !== process.version
      || launch.abi !== process.versions.modules) throw fail('target-launch-identity');
    const stdout = (await read('child-stdout.bin', OUTPUT_BYTES)).buffer.toString('utf8');
    const stderr = (await read('child-stderr.bin', OUTPUT_BYTES)).buffer.toString('utf8');
    const dumps = finalInventory.files.filter(file => /^native(?:_[a-zA-Z0-9_.-]+)?\.dmp$/u.test(file.name));
    if (dumps.length > 1) throw fail('ambiguous-target-dumps');
    let dump = null;
    if (dumps.length) {
      const file = dumps[0], observed = await read(file.name, WINDOWS_MINIDUMP_MAX_BYTES);
      dump = Object.freeze({ path: path.join(directory, file.name), sha256: observed.hash,
        ...inspectWindowsMinidump(observed.buffer, { expectedPid: launch.pid }) });
      // Keep the demonstrated native exception even if later reply, integrity,
      // publication or metadata work fails. Diagnostic failure is secondary.
      result = Object.freeze({ childResult: Object.freeze({ exitCode: dump.exceptionCode, signal: null, stdout, stderr,
        durationMs: processResult?.durationMs ?? null, outputCapture: { stdout: { truncated: true }, stderr: { truncated: true } } }),
      crashCapture: Object.freeze({ requested: true, enabled: true, collector: 'windows-cdb', status: 'failed',
        reason: 'collector-incomplete-after-owned-exception', dumpDir: directory, dumpFiles: Object.freeze([dump.path]), dump,
        execution: config.testRunDebugger ? 'fixture-controlled' : 'real-debugger', nativeQualification: 'pending' }) });
    }
    let reply = null;
    if (finalInventory.files.some(file => file.name === 'child-exit.json')) {
      reply = await readJson('child-exit.json');
      if (reply.schemaVersion !== 1 || reply.token !== token || reply.pid !== launch.pid
        || !Number.isSafeInteger(reply.exitCode) || reply.outputFailure !== null) throw fail('target-exit-reply');
      for (const name of ['stdout', 'stderr']) {
        const stream = reply.outputCapture?.[name], file = finalInventory.files.find(file => file.name === `child-${name}.bin`);
        if (!stream || !Number.isSafeInteger(stream.bytes) || !Number.isSafeInteger(stream.capturedBytes)
          || stream.bytes < 0 || stream.capturedBytes < 0 || stream.capturedBytes > OUTPUT_BYTES
          || stream.capturedBytes !== file?.bytes || stream.bytes < stream.capturedBytes
          || stream.truncated !== (stream.bytes > stream.capturedBytes)) throw fail('target-output-reply');
      }
    }
    if (!reply && !dump) throw fail('no-target-exit-or-owned-dump');
    let progress = Object.freeze({ status: 'unavailable', lastCompletedPhase: null, sequence: null });
    if (finalInventory.files.some(file => file.name === 'child-progress.ndjson')) {
      const text = (await read('child-progress.ndjson', 16 * 1024)).buffer.toString('utf8');
      const lines = text.split('\n'), complete = lines.pop() === '';
      if (lines.length > 64) throw fail('target-progress-extent');
      for (let index = 0; index < lines.length; index++) {
        const event = JSON.parse(lines[index]);
        if (event.schemaVersion !== 1 || event.token !== token || event.pid !== launch.pid || event.sequence !== index + 1
          || !WINDOWS_CDB_CHILD_PHASES.includes(event.phase)) throw fail('target-progress-identity');
        progress = Object.freeze({ status: complete ? 'recorded' : 'partial', lastCompletedPhase: event.phase, sequence: event.sequence });
      }
    }
    const after = [];
    for (const input of before) {
      const observed = remember(await sha256FileObservation(input.path, { containedRoot: path.parse(input.path).root }), 'final-input-hash');
      if (observed.value !== input.sha256 || observed.bytes !== input.bytes
        || observed.fileIdentity.dev !== input.fileIdentity.dev || observed.fileIdentity.ino !== input.fileIdentity.ino) throw fail('runtime-input-changed');
      after.push(input);
    }
    const debuggerFailed = processFailure !== null || monitorFailure !== null || processResult?.exitCode !== 0 || Boolean(processResult?.signal);
    const crashCapture = Object.freeze({ requested: true, enabled: true, collector: 'windows-cdb',
      status: debuggerFailed ? 'failed' : dump ? 'captured' : 'no-dump',
      reason: debuggerFailed ? 'debugger-or-growth-monitor-failed' : dump ? null : 'target-produced-no-exception-minidump',
      dumpDir: directory, dumpFiles: Object.freeze(dump ? [dump.path] : []), dump,
      debuggerExitCode: Number.isSafeInteger(processResult?.exitCode) ? processResult.exitCode : null,
      diagnosticsComplete: typeof debugOutput?.stdout === 'string' && typeof debugOutput?.stderr === 'string'
        && debugOutput?.outputCapture?.stdout?.truncated === false && debugOutput?.outputCapture?.stderr?.truncated === false,
      execution: config.testRunDebugger ? 'fixture-controlled' : 'real-debugger', inputs: Object.freeze(after),
      nativeQualification: 'pending' });
    const captureWithProgress = Object.freeze({ ...crashCapture, progress,
      diagnosticsComplete: crashCapture.diagnosticsComplete && progress.status === 'recorded' });
    // CDB's own zero exit after q is not the debuggee's status. A validated
    // exception stream, or the exact ordinary exit reply, owns that status.
    const childResult = Object.freeze({ exitCode: dump?.exceptionCode ?? reply?.exitCode ?? null, signal: null,
      stdout, stderr, durationMs: processResult?.durationMs ?? null,
      outputCapture: reply?.outputCapture ?? { stdout: { truncated: true }, stderr: { truncated: true } } });
    result = Object.freeze({ childResult, crashCapture: captureWithProgress });
    remember(await atomicWriteJson(path.join(directory, 'capture.json'), captureWithProgress), 'capture-write');
    remember(await inventory(directory), 'published-inventory');
    if (debuggerFailed) {
      failure = fail('debugger-or-growth-monitor-failed', { crashCapture: captureWithProgress, childResult });
    }
    requireOriginals();
  } catch (error) { observations.push(observeStorageResource(error, { phase: 'windows-cdb-original-failure' })); failure = combine(failure, error); }
  finally {
    polling = false; if (timer) clearInterval(timer); if (poll) await poll;
    if (reservation) {
      try {
        await releaseMetadata();
      } catch (error) { failure = combine(failure, error); }
    }
  }
  if (failure !== null) {
    // Missing/incomplete child evidence can fail before the final debugger
    // classification above. Preserve the original launch/monitor failures on
    // every path, including evidence reads and metadata retirement failures.
    if (processFailure !== null) failure = combine(failure, processFailure);
    if (monitorFailure !== null) failure = combine(failure, monitorFailure);
    const context = { windowsCdbAttemptDirectory: directory, windowsCdbResourceId: resourceId };
    if (reservation && !released) Object.assign(context, { cacheOwnershipPending: true,
      cacheOwnershipReleased: () => {
        try { return released && observations.every(observation => observation.isSettled()); } catch { return false; }
      }, windowsCdbSession: session });
    const retained = addStorageFailureContext(failure, context, null, { nonEnumerable: ['windowsCdbSession'] });
    const failedResult = result ? Object.freeze({ childResult: result.childResult,
      crashCapture: Object.freeze({ ...result.crashCapture, status: 'failed',
        reason: result.crashCapture.reason || 'collector-lifecycle-or-evidence-failure' }) }) : Object.freeze({ childResult: null, crashCapture: Object.freeze({ requested: true,
      enabled: true, collector: 'windows-cdb', status: 'failed', reason: 'collector-failed-before-target-evidence',
      dumpDir: directory, dumpFiles: Object.freeze([]), nativeQualification: 'pending' }) });
    retainFailure(retained, failedResult, reservation && !released ? session : null);
    throw retained;
  }
  return result;
};
