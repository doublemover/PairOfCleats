export class SubprocessError extends Error {
  constructor(message, result, cause) {
    super(message);
    this.name = 'SubprocessError';
    this.code = 'SUBPROCESS_FAILED';
    this.result = result;
    if (cause) this.cause = cause;
  }
}

export class SubprocessTimeoutError extends Error {
  constructor(message, result) {
    super(message);
    this.name = 'SubprocessTimeoutError';
    this.code = 'SUBPROCESS_TIMEOUT';
    this.result = result;
  }
}

export class SubprocessAbortError extends Error {
  constructor(message, result) {
    super(message);
    this.name = 'AbortError';
    this.code = 'ABORT_ERR';
    this.result = result;
  }
}
