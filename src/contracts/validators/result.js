export const formatValidationError = (error) => {
  const path = error.instancePath || '/';
  const message = error.message || 'schema error';
  return `${path} ${message}`.trim();
};

export const formatValidatorErrors = (validator) => (
  validator.errors ? validator.errors.map(formatValidationError) : []
);

export const toValidationResult = (validator, payload) => {
  const ok = Boolean(validator(payload));
  return {
    ok,
    errors: ok ? [] : formatValidatorErrors(validator)
  };
};
