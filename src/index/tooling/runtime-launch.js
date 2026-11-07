import { resolveDotnetRuntimeLaunch } from './dotnet-runtime.js';
import { resolveManagedNodePackageLaunch } from '../../shared/managed-node-package.js';

/** Compose only registered runtime families. Original package/SDK generations
 * remain separate entries in the existing managed-command lease protocol. */
export const resolveToolingRuntimeLaunch = options => {
  const dotnet = resolveDotnetRuntimeLaunch(options);
  const node = resolveManagedNodePackageLaunch({ ...options, command: dotnet.command, baseEnv: dotnet.environment });
  return { ...node, managedRuntimeCommands: [...dotnet.managedRuntimeCommands, ...node.managedRuntimeCommands] };
};
