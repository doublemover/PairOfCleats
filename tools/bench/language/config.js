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
    if (!validation.ok) {
      const sample = validation.issues.slice(0, 12);
      for (const issue of sample) {
        emitBenchLog(
          onLog,
          `[bench-config] ${issue.language}: ${issue.message}`,
          'error'
        );
      }
      if (validation.issues.length > sample.length) {
        emitBenchLog(
          onLog,
          `[bench-config] ... ${validation.issues.length - sample.length} more issue(s)`,
          'error'
        );
      }
      process.exit(1);
    }
    return config;
  } catch (err) {
    emitBenchLog(onLog, `Failed to read ${configPath}`, 'error');
    if (err && err.message) emitBenchLog(onLog, err.message, 'error');
    process.exit(1);
  }
};
