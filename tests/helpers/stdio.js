export const getCombinedOutput = (result, { trim = false } = {}) => {
  const stdout = result?.stdout ?? '';
  const stderr = result?.stderr ?? '';
  let output = '';
  if (stdout) output += stdout;
  if (stderr) output += output ? `\n${stderr}` : stderr;
  return trim ? output.trim() : output;
};
