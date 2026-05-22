/**
 * Read a flag value from argv supporting `--name value` and `--name=value`.
 *
 * @param {string[]} args
 * @param {string} name
 * @returns {string|null}
 */
export const readFlagValue = (args, name) => {
  const flag = `--${name}`;
  const flagEq = `${flag}=`;
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] || '');
    if (arg === flag) {
      const next = args[i + 1];
      return next ? String(next) : null;
    }
    if (arg.startsWith(flagEq)) {
      return arg.slice(flagEq.length);
    }
  }
  return null;
};
