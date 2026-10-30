import path from 'node:path';
import { getTestEnvConfig } from '../../src/shared/env/testing.js';
import { WINDOWS_CDB_OUTPUT_BYTES } from './windows-cdb-protocol.js';
export { WINDOWS_CDB_COMMANDS } from './windows-cdb-protocol.js';

const collectors = new WeakMap(), failureResults = new WeakMap(), failureSessions = new WeakMap();
const fullPath = value => typeof value === 'string' && path.isAbsolute(value) && !/[\u0000\r\n]/u.test(value);
const fail = reason => Object.assign(new Error(`Windows CDB capture failed: ${reason}`), { code: 'ERR_WINDOWS_CDB_CAPTURE', reason });
const failureLookup = (map, error) => error !== null && ['object', 'function'].includes(typeof error) ? map.get(error) || null : null;

/** Explicit internal diagnostic capability. Construction never launches CDB,
 * loads the collector's IO runtime, installs anything or changes Windows policy.
 * A serialized configuration/result cannot manufacture this producer identity.
 */
export const createWindowsCdbCollector = ({ debuggerPath, captureRoot, nativeInputs = [], symbolDirectories = [], timeoutMs = 30000,
  testRunDebugger = null } = {}) => {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw fail('unsupported-platform');
  if (!fullPath(debuggerPath) || path.basename(debuggerPath).toLowerCase() !== 'cdb.exe'
    || !fullPath(captureRoot) || !Array.isArray(nativeInputs) || nativeInputs.length > 32
    || nativeInputs.some(file => !fullPath(file)) || !Array.isArray(symbolDirectories) || symbolDirectories.length > 8
    || symbolDirectories.some(directory => !fullPath(directory) || /[;*]/u.test(directory))
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw fail('explicit-bounded-configuration-required');
  }
  if (testRunDebugger !== null && (typeof testRunDebugger !== 'function' || !getTestEnvConfig().testing)) throw fail('untrusted-test-runner');
  const capability = Object.freeze({ kind: 'windows-cdb-minidump', schemaVersion: 1 });
  collectors.set(capability, Object.freeze({ debuggerPath: path.resolve(debuggerPath), captureRoot: path.resolve(captureRoot),
    nativeInputs: Object.freeze([...new Set(nativeInputs.map(file => path.resolve(file)))]),
    symbolDirectories: Object.freeze([...new Set(symbolDirectories.map(directory => path.resolve(directory)))]), timeoutMs, testRunDebugger }));
  return capability;
};
export const isWindowsCdbCollector = value => Boolean(value) && collectors.has(value);
export const getWindowsCdbFailureResult = error => failureLookup(failureResults, error);
export const getWindowsCdbSession = error => failureLookup(failureSessions, error);

export const runWindowsCdbCollector = async (capability, options) => {
  const config = collectors.get(capability);
  if (!config || typeof options?.script !== 'string' || Buffer.byteLength(options.script) > WINDOWS_CDB_OUTPUT_BYTES
    || !fullPath(options.cwd) || !options.env || typeof options.env !== 'object') throw fail('invalid-capability-or-child-input');
  if (config.testRunDebugger && !getTestEnvConfig().testing) throw fail('untrusted-test-runner');
  const { runWindowsCdbCapture } = await import('./windows-cdb-runtime.js');
  return runWindowsCdbCapture(config, options, (error, result, session) => {
    failureResults.set(error, result); if (session) failureSessions.set(error, session);
  });
};
