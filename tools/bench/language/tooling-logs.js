import path from 'node:path';
import { getEnvConfig } from '../../../src/shared/env/runtime.js';

/** Keep per-checkout diagnostic files beside durable receipts rather than disposable index caches. */
export const resolveBenchmarkToolingLogs = ({ env = {}, userConfig = {}, receiptPath, outFile } = {}) => {
  const launchDir = getEnvConfig(env).toolingLogDir;
  const configuredDir = typeof userConfig.tooling?.logDir === 'string' ? userConfig.tooling.logDir.trim() : '';
  const source = launchDir ? 'launch-environment' : configuredDir ? 'configuration' : 'benchmark-default';
  const evidencePath = receiptPath || outFile;
  if (source === 'benchmark-default' && (typeof evidencePath !== 'string' || !evidencePath.trim())) {
    throw new Error('Benchmark tooling logs require a durable receipt or result path.');
  }
  const dir = launchDir || configuredDir || path.join(path.dirname(path.resolve(evidencePath)), 'tooling-logs');
  return { dir, source, env: { ...env, PAIROFCLEATS_TOOLING_LOG_DIR: dir } };
};
