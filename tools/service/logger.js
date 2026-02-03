import { getEnvConfig } from '../../src/shared/env.js';
import { configureLogger, log, logError, logLine, updateLogContext } from '../../src/shared/progress.js';
import { loadUserConfig } from '../shared/dict-utils.js';

const normalizeLevel = (value) => {
  if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
  return 'info';
};

const normalizeFormat = (value) => {
  if (value === 'json' || value === 'pretty') return value;
  return 'text';
};

export function configureServiceLogger({ repoRoot, service, context = {} }) {
  const envConfig = getEnvConfig();
  const userConfig = repoRoot ? loadUserConfig(repoRoot) : {};
  const loggingConfig = userConfig?.logging || {};
  const logFormat = normalizeFormat(envConfig.logFormat || loggingConfig.format);
  const logLevel = normalizeLevel(envConfig.logLevel || loggingConfig.level);
  const ringMax = Number.isFinite(Number(loggingConfig.ringMax))
    ? Math.max(1, Math.floor(Number(loggingConfig.ringMax)))
    : 200;
  const ringMaxBytes = Number.isFinite(Number(loggingConfig.ringMaxBytes))
    ? Math.max(1024, Math.floor(Number(loggingConfig.ringMaxBytes)))
    : 2 * 1024 * 1024;
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
