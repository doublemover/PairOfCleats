import path from 'node:path';
import fs from 'node:fs';
import { resolveManagedToolInstallation } from './managed-installation.js';
import { resolveStorageLayout } from './storage/layout.js';
import { isPathWithinRoot } from './file-paths.js';
import { observeStorageResource } from './storage/failure-observation.js';

export const PYRIGHT_MANAGED_VERSION = '1.1.414';
export const PYRIGHT_MANAGED_RECIPE = 'pyright-official-prebuilt-node-package';
const entryName = 'langserver.index.js';
const token = command => path.basename(String(command || '')).toLowerCase().replace(/\.(exe|cmd|bat)$/u, '');
const fail = message => Object.assign(new Error(message), { code: 'ERR_TOOLING_NODE_RUNTIME_UNAVAILABLE' });
const unchanged = (command, args, environment) => ({ command, args, environment, managedRuntimeCommands: [] });
const nativePath = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

/** The descriptor's command remains the owned vendor entry file. Node is the
 * running application's runtime, never a PATH lookup, copied runtime or package
 * install. The existing managed-command closure leases the entire script package
 * before actual child admission, just as it leases a managed .NET assembly.
 * This function performs read-only selection; it grants no lease itself. */
export const resolveManagedNodePackageLaunch = ({ command, args = [], providerId = null, toolingRoot = null, baseEnv = process.env } = {}) => {
  const environment = { ...baseEnv };
  const defaultCommand = token(command) === 'pyright-langserver' && !path.isAbsolute(command || '')
    && !String(command).includes('/') && !String(command).includes('\\');
  const currentNode = path.isAbsolute(command || '') && nativePath(command) === nativePath(process.execPath);
  const nodeEntry = path.basename(String(command || '')) !== entryName && args.length && path.isAbsolute(args[0] || '')
    && (token(command) === 'node' || currentNode || path.basename(args[0]) === entryName);
  const provider = ['pyright', 'lsp-pyright'].includes(providerId);
  const nodeHost = token(command) === 'node' || currentNode;
  if (!defaultCommand && !nodeEntry && !provider && !nodeHost) return unchanged(command, args, environment);
  toolingRoot ||= resolveStorageLayout().descriptors.tooling.path;
  const installs = path.join(path.resolve(toolingRoot), 'installs');
  const packageOwner = path.join(installs, 'pyright');
  const packageArgument = nodeHost && args.some(argument => typeof argument === 'string' && path.isAbsolute(argument) && isPathWithinRoot(argument, packageOwner));
  if (packageArgument && (!nodeEntry || !isPathWithinRoot(args[0], packageOwner))) {
    throw fail('Managed Pyright requires its canonical entry as the first Node argument; unsupported host flags cannot bypass package ownership.');
  }
  const entry = nodeEntry ? args[0] : command;
  const managedEntry = path.isAbsolute(entry || '') && isPathWithinRoot(entry, installs);
  if (!defaultCommand && !managedEntry) return unchanged(command, args, environment);
  const selected = resolveManagedToolInstallation(toolingRoot, 'pyright');
  if (!selected) {
    let selectorObserved = false;
    try { fs.lstatSync(path.join(installs, 'pyright', 'current.json')); selectorObserved = true; }
    catch (error) {
      const observation = observeStorageResource(error, { phase: 'managed-node-selection' });
      if (observation.read('code') !== 'ENOENT') throw Object.assign(fail('Managed Pyright selection is unreadable; preserve it for explicit repair.'), { cause: observation.primary });
    }
    if (managedEntry || selectorObserved) throw fail('The selected managed Pyright package is missing or changed; repair its generation before launch.');
    return unchanged(command, args, environment);
  }
  if (selected.recipeId !== PYRIGHT_MANAGED_RECIPE || selected.version !== PYRIGHT_MANAGED_VERSION
    || path.basename(selected.command) !== entryName || path.dirname(selected.command) !== selected.root) {
    throw fail('Selected Pyright generation does not match the canonical prebuilt Node package.');
  }
  if (managedEntry && nativePath(entry) !== nativePath(selected.command)) throw fail('Managed Node entry differs from its selected physical generation.');
  if (!/^v26\./u.test(process.version)) throw fail('Managed Pyright requires the supported application Node 26 runtime.');
  if (nodeEntry && (path.isAbsolute(command || '') ? !currentNode : token(command) !== 'node')) throw fail('Managed Pyright cannot switch to a different Node runtime.');
  return { command: process.execPath, args: nodeEntry ? args : [selected.command, ...args], environment,
    managedRuntimeCommands: [{ toolId: 'pyright', command: selected.command, descriptorId: selected.descriptorId, installId: selected.installId }] };
};
