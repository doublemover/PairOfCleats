import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';
import { assertDirectoryIdentity } from '../../src/shared/io/directory-sync.js';
import { persistenceFileIdentity, assertPersistenceFileIdentity } from '../../src/shared/io/file-identity.js';
import { createContainedFileResource } from '../../src/shared/contained-file-resource.js';
import { readJsonResourceTextSync } from '../../src/shared/file-read-resource.js';
import { createCollector } from '../../src/shared/subprocess/options.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { readErrorDataProperty } from '../../src/shared/error-data.js';
import { requireCheckoutMutationSession } from './checkout-mutation.js';

const MIB = 1024 * 1024, METADATA_RESERVE = 32 * 1024;
export const NATIVE_DIAGNOSTIC_LIMITS = Object.freeze({ attempts: 384, diskBytes: 32 * MIB,
  attemptBytes: 8 * MIB, tailBytes: 4096, commandBytes: 8192 });
const diagnosticFailures = new WeakSet();
export const isNativeDiagnosticFailure = error => error !== null && ['object', 'function'].includes(typeof error)
  && diagnosticFailures.has(error);
const problem = message => Object.assign(new Error(message), { code: 'ERR_NATIVE_SETUP_DIAGNOSTICS' });

/** One original native invocation's bounded evidence. Child raw bytes are
 * written synchronously through original descriptor methods; no unbounded
 * callback queue or full transcript is retained. Compiler and evidence outcomes
 * remain independent, and a failed evidence owner never authorizes fallback.
 */
export const createNativeSetupDiagnostics = (root, session, { limits = NATIVE_DIAGNOSTIC_LIMITS,
  io = fs, publish = atomicWriteJson } = {}) => {
  requireCheckoutMutationSession(root, session); root = session.root;
  limits = Object.freeze({ ...limits });
  for (const key of Object.keys(NATIVE_DIAGNOSTIC_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > NATIVE_DIAGNOSTIC_LIMITS[key]) throw new TypeError('Invalid native diagnostic bound.');
  }
  const methods = { receiver: io, stat: io.fstatSync, read: io.readSync, close: io.closeSync,
    write: io.writeSync, sync: io.fsyncSync };
  const open = io.openSync;
  let directory = null, directoryIdentity = null, reservedBytes = 0, writtenBytes = 0, attempts = 0;
  let terminalFailure = null;
  const rows = [];
  const originalRecords = new WeakMap();
  const check = () => {
    requireCheckoutMutationSession(root, session);
    if (directory) assertDirectoryIdentity(fs.lstatSync(directory, { bigint: true }), directoryIdentity);
  };
  const prepare = () => {
    check(); if (directory) return;
    let parent = root;
    for (const part of ['.tmp', 'checkout-bootstrap', 'logs']) {
      parent = path.join(parent, part);
      try { fs.mkdirSync(parent); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const stat = fs.lstatSync(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw problem('Native logs require regular owned directories.');
    }
    directory = fs.mkdtempSync(path.join(parent, 'n-'));
    directoryIdentity = fs.lstatSync(directory, { bigint: true }); assertDirectoryIdentity(directoryIdentity);
  };
  const markFailure = (value, fields, secondary, present = false) => {
    const error = addStorageFailureContext(value, fields, secondary, { secondaryPresent: present });
    diagnosticFailures.add(error); return error;
  };
  return Object.freeze({
    readOutput: (record, channel, { maxBytes = MIB } = {}) => {
      if (terminalFailure) throw terminalFailure;
      const streams = record && originalRecords.get(record), source = streams?.find(stream => stream.channel === channel);
      if (!source || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MIB) throw new TypeError(
        'Native output reads require their original completed record, channel and bounded byte allowance.');
      try {
        check(); assertPersistenceFileIdentity(fs.lstatSync(source.file, { bigint: true }), source.identity);
        const text = readJsonResourceTextSync(source.file, stat => {
          if (stat.size !== source.writtenBytes || stat.size > maxBytes) throw problem('Native structured output exceeds its exact bounded byte extent.');
        }, stat => assertPersistenceFileIdentity(stat, source.identity));
        check(); assertPersistenceFileIdentity(fs.lstatSync(source.file, { bigint: true }), source.identity);
        if (createHash('sha256').update(text).digest('hex') !== source.sha256) throw problem('Native structured output differs from its original raw-byte hash or UTF-8 encoding.');
        return text;
      } catch (error) {
        terminalFailure = markFailure(problem('Native structured output evidence could not be admitted.'), { diagnostics: record }, error, true);
        throw terminalFailure;
      }
    },
    snapshot: () => Object.freeze({ runId: session.runId, directory, attempts, reservedBytes, writtenBytes,
      limits, records: Object.freeze([...rows]) }),
    run: async (command, args, options, spawn) => {
      if (terminalFailure) throw terminalFailure;
      const selected = Object.freeze({ command, args: Object.freeze([...args]) });
      let recordPath = null, primary, failed = false, result = null, attempt = null, childAdmitted = false;
      const streams = [], logErrors = [];
      const remember = error => { if (!logErrors.includes(error)) logErrors.push(error); };
      let attemptBytes = 0, active = true;
      const startedAt = Date.now();
      try {
        if (typeof command !== 'string' || !args.every(arg => typeof arg === 'string')
          || Buffer.byteLength(JSON.stringify(selected)) > limits.commandBytes) throw problem('Native command identity exceeds its diagnostic bound.');
        if (attempts >= limits.attempts || reservedBytes + writtenBytes + METADATA_RESERVE > limits.diskBytes) throw problem('Native run diagnostic budget exhausted before child admission.');
        prepare(); reservedBytes += METADATA_RESERVE;
        attempt = ++attempts;
        const prefix = path.join(directory, String(attempt).padStart(3, '0'));
        recordPath = prefix + '.json';
        for (const channel of ['stdout', 'stderr']) {
          check(); const file = prefix + '.' + channel;
          const fd = open.call(io, file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0), 0o600);
          const owner = createContainedFileResource({ fd, sync: true, methods, additionalMethods: ['write', 'sync'] });
          const stream = { channel, file, owner, tail: createCollector({ enabled: true, maxOutputBytes: limits.tailBytes, encoding: 'utf8' }),
            hash: createHash('sha256'), writtenBytes: 0, observedBytes: 0 };
          streams.push(stream);
          const stat = owner.operations.stat({ bigint: true }); persistenceFileIdentity(stat);
        }
        const receive = stream => chunk => {
          try {
            if (!active) throw problem('Native diagnostic callback outlived its original command.');
            stream.observedBytes += chunk.length;
            if (attemptBytes + chunk.length > limits.attemptBytes || reservedBytes + writtenBytes + chunk.length > limits.diskBytes) throw problem('Native output exceeded its aggregate or per-attempt diagnostic budget.');
            let offset = 0;
            while (offset < chunk.length) {
              const count = stream.owner.operations.write(chunk, offset, chunk.length - offset, null);
              if (!Number.isSafeInteger(count) || count < 1 || count > chunk.length - offset) throw problem('Native log write did not confirm exact byte progress.');
              const written = chunk.subarray(offset, offset + count);
              stream.hash.update(written); stream.tail.push(written); stream.writtenBytes += count;
              writtenBytes += count; attemptBytes += count; offset += count;
            }
            if (options.stdio === 'inherit') {
              const output = stream.channel === 'stdout' ? process.stdout : process.stderr;
              let forwarded = 0;
              while (forwarded < chunk.length) {
                const count = fs.writeSync(output.fd, chunk, forwarded, chunk.length - forwarded);
                if (!Number.isSafeInteger(count) || count < 1) throw problem('Native terminal forwarding made no confirmed progress.');
                forwarded += count;
              }
            }
          } catch (error) { remember(error); throw error; }
        };
        childAdmitted = true;
        result = await spawn(command, selected.args, { ...options, stdio: 'pipe', captureStdout: false, captureStderr: false,
          onStdoutChunk: receive(streams[0]), onStderrChunk: receive(streams[1]) });
      } catch (error) { primary = error; failed = true; if (!childAdmitted) remember(error); }
      active = false;
      for (const stream of streams) {
        try { stream.owner.runSync(descriptor => {
          if (descriptor.sync() !== undefined) throw problem('Native log synchronization did not confirm its standard void result.');
          const actual = descriptor.stat({ bigint: true });
          if (actual.size !== BigInt(stream.writtenBytes)) throw problem('Native log length changed outside its original writer.');
          assertPersistenceFileIdentity(fs.lstatSync(stream.file, { bigint: true }), persistenceFileIdentity(actual));
          stream.identity = persistenceFileIdentity(actual);
        }); } catch (error) { remember(error); }
        if (stream.owner.isSettled() && stream.identity) {
          try {
            // Windows may finish last-write metadata at close. Keep the exact
            // original inode/extent, then seal its post-close read identity.
            const closed = persistenceFileIdentity(fs.lstatSync(stream.file, { bigint: true }));
            if (['dev', 'ino', 'mode', 'nlink', 'size', 'birthtime'].some(key => closed[key] !== stream.identity[key])) throw problem(
              'Native log pathname changed while its original descriptor closed.');
            stream.identity = closed;
          } catch (error) { remember(error); }
        }
      }
      const childResult = failed ? readErrorDataProperty(primary, 'result') : result;
      const logs = Object.freeze(streams.map(stream => Object.freeze({ channel: stream.channel, path: stream.file,
        observedBytes: stream.observedBytes, writtenBytes: stream.writtenBytes, sha256: stream.hash.digest('hex'),
        tail: stream.tail.toOutput('string'), capture: Object.freeze(stream.tail.stats()) })));
      const record = Object.freeze({ schemaVersion: 1, kind: 'native-command-diagnostics', runId: session.runId,
        attempt, ...selected, startedAt, finishedAt: Date.now(), logs,
        compiler: Object.freeze({ exitCode: readErrorDataProperty(childResult, 'exitCode') ?? null,
          signal: readErrorDataProperty(childResult, 'signal') ?? null }), byteStreamsComplete: streams.length === 2 && !logErrors.length });
      let metadataPublished = false;
      if (recordPath) {
        try {
          check(); const serialized = JSON.stringify(record), expectedBytes = Buffer.byteLength(serialized);
          if (expectedBytes > METADATA_RESERVE) throw problem('Native attempt metadata exceeded its reserved bytes.');
          const published = await publish(recordPath, record, { mkdir: false, createOnly: true, mode: 0o600,
            durable: true, spaces: 0, newline: false, beforeCommit: check });
          if (typeof published !== 'string' || path.resolve(published) !== path.resolve(recordPath)) throw problem(
            'Native attempt metadata publication did not confirm its original destination.');
          const publishedIdentity = persistenceFileIdentity(fs.lstatSync(recordPath, { bigint: true }));
          const actual = readJsonResourceTextSync(recordPath, stat => {
            if (stat.size !== expectedBytes) throw problem('Native attempt metadata does not match its bounded original byte extent.');
          }, stat => assertPersistenceFileIdentity(stat, publishedIdentity));
          check(); assertPersistenceFileIdentity(fs.lstatSync(recordPath, { bigint: true }), publishedIdentity);
          if (actual !== serialized) throw problem('Native attempt metadata does not match its original completed record.');
          metadataPublished = true;
        } catch (error) { remember(error); }
      }
      const diagnostics = Object.freeze({ ...record, metadataPublished, evidenceComplete: record.byteStreamsComplete && metadataPublished });
      if (recordPath) rows.push(diagnostics);
      if (diagnostics.evidenceComplete) originalRecords.set(diagnostics, Object.freeze(streams.map((stream, index) => Object.freeze({
        channel: stream.channel, file: stream.file, identity: stream.identity,
        writtenBytes: stream.writtenBytes, sha256: logs[index].sha256
      }))));
      if (logErrors.length || !recordPath) {
        let failure = problem('Native command evidence is incomplete; log: ' + (recordPath || directory || 'not created before admission failed') + '.');
        failure = markFailure(failure, { result: childResult, diagnostics, diagnosticsPath: recordPath }, primary, failed);
        for (const error of logErrors) failure = markFailure(failure, { diagnosticsPath: recordPath }, error, true);
        terminalFailure = markFailure(failure, { diagnostics, diagnosticsPath: recordPath });
        throw terminalFailure;
      }
      if (failed) throw addStorageFailureContext(primary, { diagnostics, diagnosticsPath: recordPath });
      return { ...result, stdout: options.stdio === 'inherit' ? '' : logs[0].tail,
        stderr: options.stdio === 'inherit' ? '' : logs[1].tail, diagnostics, diagnosticsPath: recordPath };
    }
  });
};
