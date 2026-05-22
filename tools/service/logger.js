import { getEnvConfig } from '../../src/shared/env/runtime.js';
import {
  normalizeLogFormat,
  normalizeLogLevel,
  normalizeLogRingMax,
  normalizeLogRingMaxBytes
} from '../../src/shared/logging/config.js';
import { configureLogger, log, logError, logLine, updateLogContext } from '../../src/shared/progress-runtime.js';
import { loadUserConfig } from '../shared/dict-utils.js';

export function configureServiceLogger({ repoRoot, service, context = {} }) {
  const envConfig = getEnvConfig();
  const userConfig = repoRoot ? loadUserConfig(repoRoot) : {};
  const loggingConfig = userConfig?.logging || {};
  const logFormat = normalizeLogFormat(envConfig.logFormat || loggingConfig.format);
  const logLevel = normalizeLogLevel(envConfig.logLevel || loggingConfig.level);
  const ringMax = normalizeLogRingMax(loggingConfig.ringMax);
  const ringMaxBytes = normalizeLogRingMaxBytes(loggingConfig.ringMaxBytes);
  configureLogger({
    enabled: logFormat !== 'text',
    pretty: logFormat === 'pretty',
    level: logLevel,
    ringMax,
    ringMaxBytes,
    redact: loggingConfig.redact,
    context: {
      service: service || 'service',
      repoRoot: repoRoot || null,
      ...context
    }
  });
  updateLogContext({ service: service || 'service' });
  return { log, logLine, logError };
}
