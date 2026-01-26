const warnOnce = (() => {
  const seen = new Set();
  return (key, message) => {
    if (seen.has(key)) return;
    seen.add(key);
    try {
      process.stderr.write(`${message}\n`);
    } catch {}
  };
})();

const createAbortError = () => {
  const err = new Error('Operation aborted');
  err.name = 'AbortError';
  err.code = 'ABORT_ERR';
  return err;
};

const throwIfAborted = (signal) => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

export { warnOnce, createAbortError, throwIfAborted };
