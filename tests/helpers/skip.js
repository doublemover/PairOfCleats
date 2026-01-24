export const SKIP_EXIT_CODE = 77;

export const skip = (reason = 'skipped') => {
  if (reason) {
    process.stdout.write(`${reason}\n`);
  }
  process.exit(SKIP_EXIT_CODE);
};

export const skipIf = (condition, reason) => {
  if (condition) skip(reason);
};
