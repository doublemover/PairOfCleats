const APPLICATION_OPTIONS = new Set(['--additionalprobingpath', '--additional-deps', '--fx-version', '--roll-forward']);
const EXEC_OPTIONS = new Set(['--depsfile', '--runtimeconfig']);

/** Parse documented .NET application-host options without treating an option's
 * value as the assembly. This is not an SDK-command dispatcher or a claim that
 * the selected runtime/assembly can execute. Tokens after the application are
 * preserved as server arguments. Unknown host options remain unsupported. */
export const parseDotnetApplicationLaunch = args => {
  if (!Array.isArray(args) || args.length > 128 || args.some(value => typeof value !== 'string' || !value.trim() || value.includes('\0'))) {
    return { error: 'Expected a bounded array of nonempty .NET launch tokens.' };
  }
  let cursor = 0;
  const exec = args[0] === 'exec';
  if (exec) cursor += 1;
  const hostOptions = [];
  while (cursor < args.length && args[cursor].startsWith('-')) {
    const name = args[cursor++];
    if (!APPLICATION_OPTIONS.has(name) && !(exec && EXEC_OPTIONS.has(name))) return { error: `Unsupported .NET application-host option: ${name}` };
    const value = args[cursor++];
    if (!value || value.startsWith('-')) return { error: `Missing value for .NET application-host option: ${name}` };
    hostOptions.push({ name, value });
  }
  const assemblyArg = args[cursor++];
  if (!assemblyArg) return { error: 'No launcher assembly path was provided.' };
  if (!assemblyArg.toLowerCase().endsWith('.dll')) return { error: `The .NET application must be a .dll path: ${assemblyArg}` };
  return { assemblyArg, hostOptions, applicationArgs: args.slice(cursor), mode: exec ? 'exec' : 'application' };
};
