import fs from 'node:fs';
import path from 'node:path';
import { resolveManagedToolInstallation } from '../../shared/managed-installation.js';
import { resolveStorageLayout } from '../../shared/storage/layout.js';
import { isPathWithinRoot } from '../../shared/file-paths.js';
import { resolveEnvPath } from '../../shared/env-path.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { findBinaryOnPath } from './binary-utils.js';
import { CSHARP_LS_VERSION, CSHARP_LS_MANAGED_RECIPE, CSHARP_LS_PACKAGE_ENTRY } from './csharp-ls-profile.js';

const token = command => path.basename(String(command || '')).toLowerCase().replace(/\.(exe|cmd|bat)$/u, '');
const comparable = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const fail = message => Object.assign(new Error(message), { code: 'ERR_TOOLING_DOTNET_RUNTIME_UNAVAILABLE' });
const selectorPresent = filename => {
  try { fs.lstatSync(filename); return true; }
  catch (error) {
    const observation = observeStorageResource(error, { phase: 'managed-dotnet-package-selection' });
    if (observation.read('code') !== 'ENOENT') throw observation.primary;
    return false;
  }
};

/** Read-only package framing. The existing .NET runtime owner subsequently
 * validates and leases the exact assembly generation and selected managed SDK.
 * An external SDK keeps its own host selection and normal command trust checks.
 * No generated wrapper, npm/NuGet operation or host probe occurs here. */
export const resolveManagedDotnetPackageLaunch = ({ command, args = [], toolingRoot = null, baseEnv = process.env } = {}) => {
  const unchanged = { command, args };
  const defaultCommand = token(command) === 'csharp-ls' && !path.isAbsolute(command || '') && !/[\\/]/u.test(command);
  const assembly = path.isAbsolute(command || '') && path.basename(command) === 'CSharpLanguageServer.dll';
  if (!defaultCommand && !assembly) return unchanged;
  toolingRoot ||= resolveStorageLayout().descriptors.tooling.path;
  const installs = path.join(path.resolve(toolingRoot), 'installs'), owner = path.join(installs, 'csharp-ls');
  const managedAssembly = assembly && isPathWithinRoot(command, owner);
  if (assembly && !managedAssembly) return unchanged;
  const selected = resolveManagedToolInstallation(toolingRoot, 'csharp-ls');
  if (!selected) {
    if (managedAssembly || selectorPresent(path.join(owner, 'current.json'))) throw fail('Managed C# package selection is missing or changed; repair it before launch.');
    return unchanged;
  }
  // Existing native apphosts keep their established runtime route. This new
  // package route admits only its canonical DLL, never a lookalike assembly.
  if (selected.recipeId !== CSHARP_LS_MANAGED_RECIPE) {
    if (managedAssembly) throw fail('Managed C# assembly does not belong to the canonical prebuilt package.');
    return { command: selected.command, args };
  }
  if (selected.version !== CSHARP_LS_VERSION || comparable(selected.command) !== comparable(path.join(selected.root, CSHARP_LS_PACKAGE_ENTRY))
    || managedAssembly && comparable(command) !== comparable(selected.command)) throw fail('Managed C# package differs from its selected physical generation.');
  const sdk = resolveManagedToolInstallation(toolingRoot, 'dotnet-sdk');
  // A damaged SDK selector must reach its existing refusal; do not redirect it
  // to a PATH host. A genuinely external compatible SDK requires no takeover.
  const host = sdk || selectorPresent(path.join(installs, 'dotnet-sdk', 'current.json')) ? 'dotnet'
    : findBinaryOnPath('dotnet', resolveEnvPath(baseEnv));
  if (!host) throw fail('The selected C# package requires a compatible .NET 10 SDK host.');
  return { command: host, args: [selected.command, ...args] };
};
