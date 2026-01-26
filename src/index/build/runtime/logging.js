import { configureLogger } from '../../../shared/progress.js';

export const configureRuntimeLogger = ({
  envConfig,
  loggingConfig,
  buildId,
  configHash,
  stage,
  root,
  logDestination,
  logFormatOverride
}) => {
  const logFormatRaw = logFormatOverride || envConfig.logFormat || loggingConfig.format || 'text';
  const logFormat = ['text', 'json', 'pretty'].includes(logFormatRaw)
    ? logFormatRaw
    : 'text';
  const destination = logDestination || loggingConfig.destination || loggingConfig.dest || null;
  const effectiveFormat = destination && logFormat === 'text' ? 'json' : logFormat;
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
    enabled: effectiveFormat !== 'text',
    pretty: effectiveFormat === 'pretty',
    level: logLevel,
    ringMax,
    ringMaxBytes,
    redact: loggingConfig.redact,
    destination,
    context: {
      runId: buildId,
      buildId,
      stage: stage || null,
      configHash: configHash || null,
      repoRoot: root
    }
  });
  return { logFormat: effectiveFormat, logLevel, ringMax, ringMaxBytes };
};
