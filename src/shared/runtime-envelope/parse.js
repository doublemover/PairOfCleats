import { coercePositiveInt as coercePositiveIntShared } from '../number-coerce.js';

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

export const coercePositiveInt = (value) => coercePositiveIntShared(value);

export const parseUvThreadpoolSize = (env = {}) => {
  const raw = env?.UV_THREADPOOL_SIZE;
  return coercePositiveInt(raw);
};

export const parseNodeOptions = (env = {}) => {
  const raw = normalizeString(env?.NODE_OPTIONS);
  return raw || null;
};

export const parseEffectiveMaxOldSpaceMb = ({ env = {}, execArgv = [] } = {}) => {
  const argv = Array.isArray(execArgv) ? execArgv : [];
  const nodeOptionsRaw = normalizeString(env?.NODE_OPTIONS || '');
  const nodeOptionsArgv = nodeOptionsRaw ? nodeOptionsRaw.split(/\s+/).filter(Boolean) : [];
  const args = [...argv, ...nodeOptionsArgv];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (typeof arg !== 'string') continue;
    if (arg.startsWith('--max-old-space-size=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isFinite(value) && value > 0) return Math.floor(value);
    }
    if (arg === '--max-old-space-size') {
      const value = Number(args[i + 1]);
      if (Number.isFinite(value) && value > 0) return Math.floor(value);
    }
  }
  return null;
};
