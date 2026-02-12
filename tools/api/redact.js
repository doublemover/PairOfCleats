import { isAbsolutePathAny } from '../../src/shared/files.js';

const REDACTED_ABSOLUTE_PATH = '<redacted:absolute-path>';
const REDACTED_PATH_REF = 'path:<redacted>';

const redactString = (value) => {
  if (isAbsolutePathAny(value)) return REDACTED_ABSOLUTE_PATH;
  if (value.startsWith('path:')) {
    const pathValue = value.slice('path:'.length).trim();
    if (isAbsolutePathAny(pathValue)) return REDACTED_PATH_REF;
  }
  return value;
};

export const redactAbsolutePaths = (value) => {
  if (Array.isArray(value)) return value.map((entry) => redactAbsolutePaths(entry));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactString(value) : value;
  }
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = redactAbsolutePaths(entry);
  }
  return output;
};

