/** Build one awaited, idempotent cleanup for request-owned backend resources. */
export const createBackendDisposer = (disposers = new Set()) => {
  let pending = null;
  return () => {
    if (!pending) {
      pending = Promise.resolve().then(async () => {
        const errors = [];
        for (const dispose of disposers) {
          try {
            await dispose();
          } catch (error) {
            errors.push(error);
          }
        }
        disposers.clear();
        if (errors.length) throw new AggregateError(errors, 'Search backend cleanup failed.');
      });
    }
    return pending;
  };
};
