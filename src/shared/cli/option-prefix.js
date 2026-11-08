/** Raw preflight scanners only inspect options preceding the first terminator. */
export const optionPrefix = args => {
  if (!Array.isArray(args)) return [];
  const end = args.indexOf('--');
  return end < 0 ? args : args.slice(0, end);
};
