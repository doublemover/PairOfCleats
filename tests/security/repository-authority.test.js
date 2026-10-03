import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadUserConfig } from '../../tools/dict-utils/config.js';
import { resolveRuntimeEnvelope } from '../../src/shared/runtime-envelope/resolve.js';
import { normalizePythonAstConfig } from '../../src/lang/python/pool.js';
import { normalizeTreeSitterWorkerConfig } from '../../src/lang/tree-sitter/worker.js';
import { resolveToolingCommandProfile } from '../../src/index/tooling/command-resolver.js';
import { resolveRuntimeCommandFromPreflight } from '../../src/index/tooling/preflight/command-profile-preflight.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { getToolingRegistry, detectTool } from '../../tools/tooling/utils.js';

applyTestEnv({ testConfig: null });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-authority-'));
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo);
const names = ['PAIROFCLEATS_TRUSTED_REPOS', 'PAIROFCLEATS_TRUSTED_CONFIG', 'PAIROFCLEATS_THREADS'];
const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
try {
  delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
  delete process.env.PAIROFCLEATS_TRUSTED_CONFIG;
  process.env.PAIROFCLEATS_THREADS = '1';
  const config = {
    runtime: { nodeOptions: '--require=unused-fixture.js', maxOldSpaceMb: 128 },
    cache: { root: path.join(tmp, 'unowned') },
    tooling: { autoInstallOnDetect: true, dir: path.join(tmp, 'commands'), lsp: { servers: [{ id: 'fixture', cmd: 'unused', args: ['unused'] }] },
      pyright: { cmd: 'unused', args: ['unused'], enabled: true } },
    sqlite: { vectorExtension: { path: path.join(tmp, 'unused.so') } }
  };
  fs.writeFileSync(path.join(repo, '.pairofcleats.json'), JSON.stringify(config));
  const safe = loadUserConfig(repo);
  assert.equal(safe.runtime.nodeOptions, undefined);
  assert.equal(safe.runtime.maxOldSpaceMb, 128);
  assert.equal(safe.cache.root, undefined);
  assert.equal(safe.tooling.dir, undefined);
  assert.equal(safe.tooling.autoInstallOnDetect, undefined);
  assert.equal(safe.tooling.lsp.servers, undefined);
  assert.equal(safe.tooling.pyright.cmd, undefined);
  assert.equal(safe.sqlite.vectorExtension, undefined);
  const envelope = resolveRuntimeEnvelope({ userConfig: safe, env: {}, cpuCount: 1 });
  assert.doesNotMatch(envelope.runtime.nodeOptions.effective.value || '', /require/);
  assert.equal(envelope.runtime.maxOldSpaceMb.requested.value, 128);
  const policy = path.join(tmp, 'user-policy.json');
  fs.writeFileSync(policy, JSON.stringify({ runtime: { nodeOptions: '--trace-warnings' }, cache: { root: path.join(tmp, 'owned') } }));
  process.env.PAIROFCLEATS_TRUSTED_CONFIG = policy;
  assert.equal(loadUserConfig(repo).runtime.nodeOptions, '--trace-warnings');
  assert.equal(loadUserConfig(repo).cache.root, path.join(tmp, 'owned'));
  process.env.PAIROFCLEATS_TRUSTED_CONFIG = path.join(repo, '.pairofcleats.json');
  assert.throws(() => loadUserConfig(repo), /outside the repository/);
  const repoPolicyLink = path.join(repo, 'policy-link.json');
  fs.symlinkSync(policy, repoPolicyLink);
  process.env.PAIROFCLEATS_TRUSTED_CONFIG = repoPolicyLink;
  assert.throws(() => loadUserConfig(repo), /outside the repository/);
  delete process.env.PAIROFCLEATS_TRUSTED_CONFIG;
  process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([repo]);
  assert.equal(loadUserConfig(repo).runtime.nodeOptions, config.runtime.nodeOptions);
  delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
  const python = normalizePythonAstConfig({ workerCount: 100000, maxWorkers: 100000, allowOverCap: true }, { hardMaxWorkers: 1 });
  assert.equal(python.workerCount, 1);
  assert.equal(python.maxWorkers, 1);
  const tree = normalizeTreeSitterWorkerConfig({ enabled: true, maxWorkers: 100000, maxQueue: 100000 });
  assert.equal(tree.maxWorkers, 1);
  assert.equal(tree.maxQueue, 256);
  assert.equal(normalizeTreeSitterWorkerConfig(true).maxWorkers, 1);
  const command = path.join(repo, 'fixture-command');
  fs.writeFileSync(command, 'inert fixture, never executed');
  const profile = resolveToolingCommandProfile({ providerId: 'fixture', cmd: command, repoRoot: repo });
  assert.equal(profile.resolved.mode, 'blocked');
  assert.deepEqual(profile.probe.attempted, []);
  const runtime = resolveRuntimeCommandFromPreflight({ preflight: { commandProfile: profile }, fallbackRequestedCommand: { cmd: command } });
  assert.equal(runtime.cmd, '', 'blocked probes must not fall back to a spawn');
  const registry = getToolingRegistry(path.join(tmp, 'approved-tool-cache'), repo);
  assert.equal(registry.some((tool) => tool.detect?.binDirs?.includes(path.join(repo, 'node_modules', '.bin'))), false);
  const luaPlan = registry.find((tool) => tool.id === 'lua-language-server').install.cache;
  assert.equal(luaPlan.args.some((arg) => String(arg).startsWith(repo)), false, 'installer implementation must come from the package');
  const blockedTool = detectTool({ authorityRepoRoot: repo, detect: { cmd: command, args: ['--version'], binDirs: [] } });
  assert.equal(blockedTool.found, false);
  assert.equal(blockedTool.source, 'blocked');
  console.log('repository execution authority and hard worker caps passed');
} finally {
  for (const name of names) {
    if (prior[name] === undefined) delete process.env[name]; else process.env[name] = prior[name];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
