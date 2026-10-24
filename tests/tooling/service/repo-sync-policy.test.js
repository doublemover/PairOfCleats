#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';

const commands = [];
globalThis.__syncPolicyCommands = commands;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/tools/service/repos.js') && specifier.endsWith('/subprocess/runner.js')) {
      return { url: 'sync-policy:git', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'sync-policy:git') return { format: 'module', shortCircuit: true,
      source: `export const spawnSubprocessSync = (command, args, options) => {
        globalThis.__syncPolicyCommands.push({ command, args, cwd: options.cwd }); return { exitCode: 0 };
      };` };
    return next(url, context);
  }
});
const { ensureRepo } = await import('../../../tools/service/repos.js');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-sync-policy-'));
try {
  for (const policy of ['none', 'fetch', 'pull']) {
    for (const spelling of [policy, policy.toUpperCase(), ` ${policy.toUpperCase()} `]) {
      for (const override of [false, true]) {
        commands.length = 0;
        const result = await ensureRepo({ path: root, ...(override ? { syncPolicy: spelling } : {}) }, root, spelling);
        assert.equal(result.ok, true);
        assert.equal(result.action, policy === 'none' ? 'skip' : policy);
        assert.deepEqual(commands, policy === 'none' ? [] : [{ command: 'git',
          args: policy === 'fetch' ? ['fetch', '--all', '--prune'] : ['pull', '--ff-only'], cwd: root }]);
      }
    }
  }
  for (const syncPolicy of ['unknown', '', true, {}]) {
    commands.length = 0;
    const result = await ensureRepo({ path: root, syncPolicy }, root);
    assert.equal(result.ok, false);
    assert.match(result.message, /Unsupported repository sync policy/);
    assert.deepEqual(commands, [], 'invalid policies cannot fall through to git pull');
  }
} finally {
  hook.deregister(); delete globalThis.__syncPolicyCommands;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('canonical repository sync policies select exactly skip, fetch or pull and reject unknown dispatch');
