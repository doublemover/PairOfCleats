import { resolveDotnetRuntimeLaunch } from './dotnet-runtime.js';
import { resolveManagedNodePackageLaunch } from '../../shared/managed-node-package.js';
import { resolveManagedDotnetPackageLaunch } from './dotnet-package.js';
import { parseDotnetApplicationLaunch } from './dotnet-launch.js';
import path from 'node:path';

/** Compose only registered runtime families. Original package/SDK generations
 * remain separate entries in the existing managed-command lease protocol. */
export const resolveToolingRuntimeLaunch = options => {
  const framed = resolveManagedDotnetPackageLaunch(options);
  const dotnet = resolveDotnetRuntimeLaunch({ ...options, ...framed });
  const node = resolveManagedNodePackageLaunch({ ...options, command: dotnet.command, args: framed.args, baseEnv: dotnet.environment });
  return { ...node, managedRuntimeCommands: [...dotnet.managedRuntimeCommands, ...node.managedRuntimeCommands] };
};

/** Version probes replace application arguments, while preserving the host's
 * exact owned entry. Probing the Node/.NET host alone cannot qualify a server. */
export const managedRuntimeProbePrefix = launch => {
  if (launch.command === process.execPath && launch.managedRuntimeCommands.some(selection => selection.toolId === 'pyright')) return launch.args.slice(0, 1);
  if (/^dotnet(?:\.exe|\.cmd|\.bat)?$/iu.test(path.basename(launch.command))
    && launch.managedRuntimeCommands.some(selection => selection.toolId === 'csharp-ls')) {
    const parsed = parseDotnetApplicationLaunch(launch.args);
    if (!parsed.error) return launch.args.slice(0, launch.args.length - parsed.applicationArgs.length);
  }
  return [];
};
