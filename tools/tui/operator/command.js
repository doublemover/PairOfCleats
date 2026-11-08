import fs from 'node:fs/promises';
import { isResolvedCommandTrusted } from '../../../src/shared/config-authority.js';
import { createBinaryDiscovery } from '../../../src/index/tooling/binary-utils.js';
import { resolveEnvPath } from '../../../src/shared/env-path.js';
import { resolveWindowsCmdInvocation } from '../../../src/shared/subprocess/windows-cmd.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { throwIfAborted } from '../../../src/shared/abort.js';

const fail = (prefix, suffix, message) => { throw Object.assign(new Error(message), { code: `${prefix}_${suffix}` }); };

/** PATH selection and command authority are shared by native operator actions. */
export const resolveTrustedTuiCommand = async ({ names, repoRoot, toolRoot, env, prefix }) => {
  const discovery = createBinaryDiscovery({ cwd: repoRoot });
  let selected = null;
  for (const name of names) {
    if (discovery.findOnPath(name, resolveEnvPath(env))) {
      selected = { name, path: discovery.getReceipt().selected.absolutePath }; break;
    }
  }
  if (!selected) fail(prefix, 'MISSING', 'Install a supported command launcher to use this action.');
  await fs.realpath(selected.path);
  if (!(await fs.stat(selected.path)).isFile()) fail(prefix, 'MISSING', 'The launcher is not a regular file.');
  if (!isResolvedCommandTrusted({ commandPath: selected.path, repoRoot, toolRoot, env })) {
    fail(prefix, 'UNTRUSTED', 'The selected repository does not have command execution authority.');
  }
  return selected;
};

export const runTrustedTuiCommand = async ({ selected, args, repoRoot, env, signal, onSpawn,
  input, beforeSpawn, prefix }) => {
  await beforeSpawn?.();
  throwIfAborted(signal);
  const invocation = process.platform === 'win32'
    ? resolveWindowsCmdInvocation(selected.path, args, env, { cwd: repoRoot }) : { command: selected.path, args };
  const child = await spawnSubprocess(invocation.command, invocation.args, {
    cwd: repoRoot, env: invocation.env || env, signal, onSpawn, input,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments === true,
    timeoutMs: 5000, maxOutputBytes: 16 * 1024,
    stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'], rejectOnNonZeroExit: true
  });
  if (child.outputCapture?.stdout?.truncated || child.outputCapture?.stderr?.truncated) {
    fail(prefix, 'OUTPUT', 'Launcher output exceeded its bound.');
  }
  return child;
};
