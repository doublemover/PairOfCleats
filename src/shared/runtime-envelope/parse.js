import { coercePositiveInt as coercePositiveIntShared } from '../number-coerce.js';
import { resolveNodeHeapSource } from '../workers/node-argv.js';

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

export const parseEffectiveMaxOldSpaceMb = ({ env = {}, execArgv = [] } = {}) => (
  resolveNodeHeapSource({ execArgv, nodeOptions: env?.NODE_OPTIONS }).value
);
