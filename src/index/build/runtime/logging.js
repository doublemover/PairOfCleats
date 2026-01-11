import { configureLogger } from '../../../shared/progress.js';

export const configureRuntimeLogger = ({ envConfig, loggingConfig, buildId, configHash, stage, root }) => {
  const logFormatRaw = envConfig.logFormat || loggingConfig.format || 'text';
  const logFormat = ['text', 'json', 'pretty'].includes(logFormatRaw)
    ? logFormatRaw
    : 'text';
  const logLevelRaw = envConfig.logLevel || loggingConfig.level || 'info';
  const logLevel = typeof logLevelRaw === 'string' && logLevelRaw.trim()
    ? logLevelRaw.trim().toLowerCase()
    : 'info';
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
      runId: buildId,
      buildId,
      stage: stage || null,
      configHash: configHash || null,
      repoRoot: root
    }
  });
  return { logFormat, logLevel, ringMax, ringMaxBytes };
};
