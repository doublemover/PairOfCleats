export const ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CAPABILITY_MISSING: 'CAPABILITY_MISSING',
  NO_INDEX: 'NO_INDEX',
  CANCELLED: 'CANCELLED',
  INTERNAL: 'INTERNAL',
  QUEUE_OVERLOADED: 'QUEUE_OVERLOADED',
  TOOL_TIMEOUT: 'TOOL_TIMEOUT',
  DOWNLOAD_VERIFY_FAILED: 'DOWNLOAD_VERIFY_FAILED',
  ARCHIVE_UNSAFE: 'ARCHIVE_UNSAFE',
  ARCHIVE_TOO_LARGE: 'ARCHIVE_TOO_LARGE'
});

export const isErrorCode = (value) => (
  typeof value === 'string' && Object.values(ERROR_CODES).includes(value)
);

export const createError = (code, message, details = null) => {
  const err = new Error(message || 'Error');
  err.code = code;
  if (details && typeof details === 'object') {
    Object.assign(err, details);
  }
  return err;
};
