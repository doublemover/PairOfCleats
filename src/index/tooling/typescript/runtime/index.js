import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSubprocess } from '../../../../shared/subprocess/runner.js';
import { trackedOwnershipIdByAbortSignal } from '../../../../shared/subprocess/tracking.js';
import { parseEffectiveMaxOldSpaceMb } from '../../../../shared/runtime-envelope/parse.js';
import { raceAbort, throwIfAborted } from '../../../../shared/abort.js';
import { isRequiredToolingComputationError } from '../../required-computation.js';
import {
  createRecordWriter, measureJsonRecord, protocolFailure, readRecords,
  resolveProtocolLimits, TYPESCRIPT_RUNTIME_PROTOCOL_VERSION
} from './protocol.js';
import { createResultAssembler } from './result.js';

const ENTRY_PATH = fileURLToPath(new URL('./entry.js', import.meta.url));
const positiveInteger = (value, key) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw protocolFailure('invalid-runtime-option', { key });
  return value;
};

export const resolveTypeScriptRuntimeHeapMb = ({ maxOldSpaceMb, env = process.env, execArgv = process.execArgv } = {}) => (
  positiveInteger(maxOldSpaceMb ?? parseEffectiveMaxOldSpaceMb({ env, execArgv }) ?? 4096, 'maxOldSpaceMb')
);

/**
 * Run exactly one whole provider invocation in an owned process. The provider
 * retains its existing config groups and full Program context, without target
 * windows or automatic retries. maxOldSpaceMb limits V8 old heap, NOT RSS or
 * native allocation. Byte limits bound serialized transport/collector data,
 * NOT JavaScript object overhead or the checker's semantic expansion.
 *
 * Supported context data is the current provider contract: repoRoot,
 * toolingConfig and strict. Logger/abort stay in the parent. Callback-based
 * semantic/compiler sessions must use their existing owner, never be dropped.
 * onRecord may be async and is awaited before reading the next output record.
 * Its observations are provisional until the returned promise succeeds.
 */
export const runTypeScriptProviderSubprocess = async (ctx, inputs, options = {}) => {
  if (ctx?.semanticSession != null || ctx?.semanticLspSession != null || ctx?.compilerSystem != null) throw protocolFailure('unsupported-compiler-session');
  if (typeof ctx?.repoRoot !== 'string' || !path.isAbsolute(ctx.repoRoot)) throw protocolFailure('invalid-repo-root');
  const limits = resolveProtocolLimits(options.protocolLimits);
  const timeoutMs = positiveInteger(options.timeoutMs ?? 60000, 'timeoutMs');
  const maxOldSpaceMb = resolveTypeScriptRuntimeHeapMb(options);
  const maxCollectorBytes = positiveInteger(options.maxCollectorBytes ?? limits.maxOutputBytes, 'maxCollectorBytes');
  const onRecord = options.onRecord;
  if (onRecord != null && typeof onRecord !== 'function') throw protocolFailure('invalid-record-callback');
  const context = { repoRoot: ctx.repoRoot, toolingConfig: ctx.toolingConfig || {}, strict: ctx.strict !== false };
  const documents = Array.isArray(inputs?.documents) ? inputs.documents : [];
  const targets = Array.isArray(inputs?.targets) ? inputs.targets : [];
  const header = { type: 'init', version: TYPESCRIPT_RUNTIME_PROTOCOL_VERSION, context,
    documents: documents.length, targets: targets.length };
  measureJsonRecord(header, limits);
  const controller = new AbortController();
  const externalSignal = options.signal ?? ctx.abortSignal ?? ctx.signal;
  if (externalSignal != null && !(externalSignal instanceof AbortSignal)) throw protocolFailure('invalid-abort-signal');
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([controller.signal, deadline, ...(externalSignal ? [externalSignal] : [])]);
  throwIfAborted(signal, 'TypeScript provider cancelled.');
  const assembler = createResultAssembler({ logger: ctx.logger });
  let inputTask, outputTask, taskError, childResult, processError;
  let collectorBytes = 0;
  const failTask = error => {
    taskError ||= error;
    controller.abort(error);
  };
  try {
    childResult = await spawnSubprocess(process.execPath, [`--max-old-space-size=${maxOldSpaceMb}`, ENTRY_PATH, JSON.stringify(limits)], {
      // Preserve relative tooling-cache lookup semantics from the launching
      // process; repository/compiler source paths use the explicit repoRoot.
      cwd: process.cwd(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'],
      captureStdout: false, captureStderr: true, maxOutputBytes: 65536,
      timeoutMs, signal, killTree: true, killGraceMs: 0,
      ownershipId: options.ownershipId ?? trackedOwnershipIdByAbortSignal.get(externalSignal), cleanupOnParentExit: true,
      name: 'typescript-provider',
      onSpawn: child => {
        // Stream errors must have an owner even between sequential writes.
        child.stdin.on('error', failTask);
        inputTask = (async () => {
          const write = createRecordWriter(child.stdin, limits, limits.maxInputBytes);
          await write(header);
          for (const value of documents) await write({ type: 'document', value });
          for (const value of targets) await write({ type: 'target', value });
          await write({ type: 'end' });
          child.stdin.end();
        })();
        inputTask.catch(failTask);
        outputTask = (async () => {
          for await (const record of readRecords(child.stdout, limits, limits.maxOutputBytes)) {
            throwIfAborted(signal);
            collectorBytes += measureJsonRecord(record, limits);
            if (collectorBytes > maxCollectorBytes) throw protocolFailure('collector-byte-limit', { limit: maxCollectorBytes });
            assembler.accept(record);
            if (onRecord) {
              throwIfAborted(signal);
              await raceAbort(signal, Promise.resolve().then(() => {
                throwIfAborted(signal);
                return onRecord.call(options, record);
              }));
            }
          }
        })();
        outputTask.catch(failTask);
      }
    });
  } catch (error) {
    processError = error;
    // Also release a stalled async record consumer after process timeout/exit.
    controller.abort(error);
  }
  await Promise.allSettled([inputTask, outputTask]);
  throwIfAborted(externalSignal, 'TypeScript provider cancelled.');
  if (deadline.aborted || processError?.code === 'SUBPROCESS_TIMEOUT') throw protocolFailure('timeout', { timeoutMs }, processError);
  const receipt = processError?.result || {};
  const heapExhausted = /JavaScript heap out of memory|Reached heap limit|Allocation failed.*heap/i.test(receipt.stderr || '');
  if (heapExhausted) throw protocolFailure('javascript-heap-exhausted', {
    exitCode: receipt.exitCode ?? null, signal: receipt.signal ?? null, pid: receipt.pid ?? null
  }, processError);
  if (taskError) {
    if (isRequiredToolingComputationError(taskError)) throw taskError;
    throw protocolFailure('transport-or-consumer-failure', null, taskError);
  }
  if (processError) {
    throw protocolFailure('child-exit', {
      exitCode: receipt.exitCode ?? null, signal: receipt.signal ?? null, pid: receipt.pid ?? null
    }, processError);
  }
  if (childResult?.exitCode !== 0) throw protocolFailure('child-exit');
  return assembler.finish();
};
