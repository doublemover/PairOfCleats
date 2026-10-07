import os from 'node:os';
import { resolveRuntimeEnvelope } from './resolve.js';

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

  return resolveRuntimeEnvelope({
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
}
