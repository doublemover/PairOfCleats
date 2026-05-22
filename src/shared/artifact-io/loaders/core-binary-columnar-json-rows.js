import { createLoaderError } from './shared.js';

export const parseBinaryColumnarJsonRow = (payload, baseName) => {
  try {
    return JSON.parse(payload.toString('utf8'));
  } catch (err) {
    throw createLoaderError(
      'ERR_ARTIFACT_CORRUPT',
      `Invalid binary-columnar row payload for ${baseName}`,
      err instanceof Error ? err : null
    );
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
