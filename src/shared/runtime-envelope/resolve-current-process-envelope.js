import os from 'node:os';
import { resolveRuntimeEnvelope } from './resolve.js';
import { observeRuntimeProcess, getNodeStartupInputs } from './observe.js';
import { resolveNodeHeapSource } from '../workers/node-argv.js';

/**
 * Resolve a runtime envelope for the current Node process.
 * @param {object} input
 * @param {object} [input.argv]
 * @param {string[]} [input.rawArgv]
 * @param {object} [input.userConfig]
 * @param {object|null} [input.autoPolicy]
 * @param {object} [input.env]
 * @param {string[]} [input.execArgv]
 * @param {string|null} [input.toolVersion]
 * @param {number|null} [input.cpuCount]
 * @returns {ReturnType<typeof resolveRuntimeEnvelope>}
 */
export function resolveCurrentProcessRuntimeEnvelope(input = {}) {
  const {
    argv = {},
    rawArgv = [],
    userConfig = {},
    autoPolicy = null,
    env = process.env,
    execArgv = process.execArgv,
    toolVersion = null,
    cpuCount = os.cpus().length
  } = input;

  const envelope = resolveRuntimeEnvelope({
    argv,
    rawArgv,
    userConfig,
    autoPolicy,
    env,
    execArgv,
    cpuCount,
    processInfo: {
      pid: process.pid,
      argv: process.argv,
      execPath: process.execPath,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount
    },
    toolVersion
  });
  const observation = observeRuntimeProcess();
  const startup = getNodeStartupInputs();
  const heap = resolveNodeHeapSource(startup);
  envelope.evidenceScope = 'current-process';
  envelope.observed = observation;
  envelope.runtime.maxOldSpaceMb.effective = { ...heap, evidenceScope: 'startup-input' };
  envelope.runtime.uvThreadpoolSize.effective = {
    value: observation.startupInputs.uvThreadpoolSize,
    source: observation.startupInputs.uvThreadpoolSize == null ? 'unknown' : 'external-env',
    detail: 'UV_THREADPOOL_SIZE',
    evidenceScope: 'startup-input'
  };
  envelope.runtime.nodeOptions.effective = {
    value: startup.nodeOptions || null,
    source: startup.nodeOptions ? 'external-env' : 'unknown',
    detail: 'NODE_OPTIONS',
    evidenceScope: 'startup-input'
  };
  for (const name of ['maxOldSpaceMb', 'uvThreadpoolSize', 'nodeOptions']) {
    const setting = envelope.runtime[name];
    setting.application = setting.planned.value === setting.effective.value
      ? 'matches-startup-input'
      : 'not-applied-to-current-process';
  }
  return envelope;
}
