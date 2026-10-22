import { createLoaderError } from './shared.js';
import { addStorageFailureContext } from '../../storage/operation-error.js';

export const parseBinaryColumnarJsonRow = (payload, baseName) => {
  try {
    return JSON.parse(payload.toString('utf8'));
  } catch (err) {
    const original = err !== null && ['object', 'function'].includes(typeof err) ? err : new Error(String(err), { cause: err });
    throw addStorageFailureContext(createLoaderError(
      'ERR_ARTIFACT_CORRUPT',
      `Invalid binary-columnar row payload for ${baseName}`,
      original
    ), {}, original, { secondaryPresent: true });
  }
};

export const assertBinaryColumnarJsonRowCount = ({
  actualCount,
  expectedCount,
  baseName
}) => {
  if (actualCount === expectedCount) return;
  throw createLoaderError(
    'ERR_ARTIFACT_CORRUPT',
    `Binary-columnar row count mismatch for ${baseName}`
  );
};
