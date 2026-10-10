/** Preserve the exact-format diagnostic through public wrappers and cleanup causes. */
export const projectIndexFormatError = (error) => {
  const seen = new Set();
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error);
    if (error.code === 'ERR_INDEX_FORMAT_UNSUPPORTED') {
      const source = error.details || error;
      const details = {};
      for (const key of ['operation', 'component', 'expectedVersion', 'foundVersion', 'repoRoot', 'indexPath', 'rebuildCommand']) {
        if (source[key] !== undefined) details[key] = source[key];
      }
      return { nativeCode: 'ERR_INDEX_FORMAT_UNSUPPORTED', ...details };
    }
    error = error.cause;
  }
  return null;
};

/** Restore metadata explicitly serialized across a worker boundary. */
export const restoreIndexFormatError = (diagnostic) => {
  const { message, nativeCode, ...details } = diagnostic;
  return Object.assign(new Error(message), details, { code: nativeCode, details });
};
