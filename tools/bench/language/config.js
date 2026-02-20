import { readJsoncFile } from '../../../src/shared/jsonc.js';
import { emitBenchLog } from './logging.js';

export const loadBenchConfig = (configPath, { onLog = null } = {}) => {
  try {
    const config = readJsoncFile(configPath);
    if (!config || typeof config !== 'object') {
      throw new Error('Bench config must be a JSON object.');
    }
    return config;
  } catch (err) {
    emitBenchLog(onLog, `Failed to read ${configPath}`, 'error');
    if (err && err.message) emitBenchLog(onLog, err.message, 'error');
    process.exit(1);
  }
};
