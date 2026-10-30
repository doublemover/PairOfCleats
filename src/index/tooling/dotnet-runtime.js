import fs from 'node:fs';
import path from 'node:path';
import { resolveManagedToolInstallation } from '../../shared/managed-installation.js';
import { resolveStorageLayout } from '../../shared/storage/layout.js';
import { isPathWithinRoot } from '../../shared/file-paths.js';
import { assertNoSymlinkPath } from '../../shared/contained-file.js';
import { normalizeEnvPathKeys, resolveEnvPath } from '../../shared/env-path.js';
import { isDotnetWorkspaceProvider } from './workspace-execution.js';
import { parseDotnetApplicationLaunch } from './dotnet-launch.js';

const token = command => path.basename(String(command || '')).toLowerCase().replace(/\.(exe|cmd|bat)$/u, '');
const fail = message => Object.assign(new Error(message), { code: 'ERR_TOOLING_DOTNET_RUNTIME_UNAVAILABLE' });

/** Read-only runtime selection. No installation, host probe or repository load.
 * Explicit external dotnet hosts keep their own runtime; managed apphosts never
 * fall back to ambient SDK discovery when their selected SDK is unavailable. */
export const resolveDotnetRuntimeLaunch = ({ command, args = [], cwd = process.cwd(), providerId, languages = [], toolingRoot, baseEnv = process.env } = {}) => {
  const environment = { ...baseEnv };
  const host = token(command) === 'dotnet';
  if (!host && !isDotnetWorkspaceProvider({ providerId, server: { cmd: command }, languages })) {
    return { command, environment, managedRuntimeCommands: [] };
  }
  toolingRoot ||= resolveStorageLayout().descriptors.tooling.path;
  const installs = path.join(path.resolve(toolingRoot), 'installs');
  const managedCommand = path.isAbsolute(command || '') && isPathWithinRoot(path.resolve(command), installs);
  const managedRuntimeCommands = [];
  if (host) {
    const parsed = parseDotnetApplicationLaunch(args);
    if (!parsed.error) {
      const assembly = path.resolve(cwd, parsed.assemblyArg);
      if (isPathWithinRoot(assembly, installs)) {
        const [toolId, generations, installId] = path.relative(installs, assembly).split(path.sep);
        const server = resolveManagedToolInstallation(toolingRoot, toolId);
        if (generations !== 'generations' || !server || server.installId !== installId || !isPathWithinRoot(assembly, server.root)) {
          throw fail('Managed .NET assembly differs from its currently selected server generation.');
        }
        try {
          assertNoSymlinkPath(server.root, assembly);
          if (!fs.lstatSync(assembly).isFile()) throw fail('Managed .NET assembly must be a regular file.');
        } catch (error) {
          throw Object.assign(fail('Managed .NET assembly is missing, linked or unreadable.'), { cause: error });
        }
        // The canonical command leases the entire server generation, including
        // this DLL and its dependencies, even when dotnet is the direct child.
        managedRuntimeCommands.push({ toolId, command: server.command, descriptorId: server.descriptorId, installId: server.installId });
      }
    }
  }
  const sdk = resolveManagedToolInstallation(toolingRoot, 'dotnet-sdk');
  if (!sdk) {
    if (managedCommand || managedRuntimeCommands.length || fs.existsSync(path.join(installs, 'dotnet-sdk', 'current.json'))) {
      throw fail('The selected managed .NET server requires an intact dotnet-sdk generation; repair that installation before launch.');
    }
    return { command, environment, managedRuntimeCommands };
  }
  if (token(sdk.command) !== 'dotnet' || path.dirname(sdk.command) !== sdk.root) throw fail('Selected dotnet-sdk does not expose its host at the SDK root.');
  if (host && path.isAbsolute(command || '') && !managedCommand) {
    return { command, environment, managedRuntimeCommands };
  }
  if (host && managedCommand && path.resolve(command) !== path.resolve(sdk.command)) {
    throw fail('Selected managed dotnet host differs from the current dotnet-sdk generation.');
  }
  for (const key of Object.keys(environment)) {
    if (/^DOTNET_ROOT(?:_.*|\(x86\))?$/iu.test(key)
      || /^(DOTNET_HOST_PATH|DOTNET_MSBUILD_SDK_RESOLVER_(CLI_DIR|SDKS_DIR|SDKS_VER)|MSBuildSDKsPath|MSBUILD_EXE_PATH)$/iu.test(key)) delete environment[key];
  }
  environment.DOTNET_ROOT = sdk.root;
  environment[`DOTNET_ROOT_${{ x64: 'X64', arm64: 'ARM64', ia32: 'X86' }[process.arch] || process.arch.toUpperCase()}`] = sdk.root;
  environment.DOTNET_HOST_PATH = sdk.command;
  environment.DOTNET_MSBUILD_SDK_RESOLVER_CLI_DIR = sdk.root;
  environment.DOTNET_MULTILEVEL_LOOKUP = '0';
  environment.DOTNET_CLI_TELEMETRY_OPTOUT = '1';
  environment.DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE = 'true';
  const pathInfo = normalizeEnvPathKeys(environment);
  environment[pathInfo.key] = [sdk.root, resolveEnvPath(environment)].filter(Boolean).join(path.delimiter);
  if (!managedRuntimeCommands.some(entry => entry.command === sdk.command)) managedRuntimeCommands.push({
    toolId: 'dotnet-sdk', command: sdk.command, descriptorId: sdk.descriptorId, installId: sdk.installId
  });
  return { command: host ? sdk.command : command, environment, managedRuntimeCommands };
};
