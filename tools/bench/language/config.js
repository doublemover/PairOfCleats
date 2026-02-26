import { readJsoncFile } from '../../../src/shared/jsonc.js';
import { emitBenchLog } from './logging.js';
import { validateBenchTierConfig } from './tier-policy.js';

export const loadBenchConfig = (configPath, { onLog = null } = {}) => {
  try {
    const config = readJsoncFile(configPath);
    if (!config || typeof config !== 'object') {
      throw new Error('Bench config must be a JSON object.');
    }
    const validation = validateBenchTierConfig(config);
    if (validation.issues.length > 0) {
      const sample = validation.issues.slice(0, 12);
      for (const issue of sample) {
        const level = issue.level === 'warn' ? 'warn' : 'error';
        emitBenchLog(
          onLog,
          `[bench-config] ${issue.language}: ${issue.message}`,
          level
        );
      }
      if (validation.issues.length > sample.length) {
        const remainingFatal = validation.issues
          .slice(sample.length)
          .filter((issue) => issue.level !== 'warn')
          .length;
        const level = remainingFatal > 0 ? 'error' : 'warn';
        emitBenchLog(
          onLog,
          `[bench-config] ... ${validation.issues.length - sample.length} more issue(s)`,
          level
        );
      }
    }
    if (!validation.ok) {
      process.exit(1);
    }
    return config;
  } catch (err) {
    emitBenchLog(onLog, `Failed to read ${configPath}`, 'error');
    if (err && err.message) emitBenchLog(onLog, err.message, 'error');
    process.exit(1);
  }
};
