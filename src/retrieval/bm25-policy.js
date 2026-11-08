import { createError, ERROR_CODES } from '../shared/error-codes.js';
export const isValidBm25Parameters = (k1, b) => Number.isFinite(k1) && k1 >= 0 && Number.isFinite(b) && b >= 0 && b <= 1;
export const assertBm25Parameters = (k1, b) => {
  if (!isValidBm25Parameters(k1, b)) throw createError(ERROR_CODES.INVALID_REQUEST,
    'BM25 requires finite k1 >= 0 and b in [0,1].');
};
