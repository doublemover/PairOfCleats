/** A required answer is unavailable, rather than an optional provider outage. */
export class ToolingRequiredComputationError extends Error {
  constructor(message, { operation = null, reason = 'incomplete', details = null, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ToolingRequiredComputationError';
    this.code = 'ERR_TOOLING_REQUIRED_COMPUTATION_INCOMPLETE';
    this.operation = operation;
    this.reason = reason;
    this.details = details;
    this.complete = false;
  }
}

// Match the stable code as errors may cross an owned worker/process boundary.
export const isRequiredToolingComputationError = error => (
  error?.code === 'ERR_TOOLING_REQUIRED_COMPUTATION_INCOMPLETE'
);
