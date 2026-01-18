import { readJsoncFile } from '../../../src/shared/jsonc.js';

export const loadBenchConfig = (configPath) => {
  try {
    const config = readJsoncFile(configPath);
    if (!config || typeof config !== 'object') {
      throw new Error('Bench config must be a JSON object.');
    }
    return config;
  } catch (err) {
    console.error(`Failed to read ${configPath}`);
    if (err && err.message) console.error(err.message);
    process.exit(1);
  }
};
