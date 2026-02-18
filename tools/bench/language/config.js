import { readJsoncFile } from '../../../src/shared/jsonc.js';

const emit = (onLog, message, level = 'error') => {
  if (typeof onLog === 'function') {
    onLog(message, level);
    return;
  }
  if (level === 'warn') {
    console.warn(message);
    return;
  }
  console.error(message);
};

export const loadBenchConfig = (configPath, { onLog = null } = {}) => {
  try {
    const config = readJsoncFile(configPath);
    if (!config || typeof config !== 'object') {
      throw new Error('Bench config must be a JSON object.');
    }
    return config;
  } catch (err) {
    emit(onLog, `Failed to read ${configPath}`, 'error');
    if (err && err.message) emit(onLog, err.message, 'error');
    process.exit(1);
  }
};
