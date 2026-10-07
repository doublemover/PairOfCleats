import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { resolveToolingCommandProfile, invalidateToolingCommandProbeCache } from '../../src/index/tooling/command-resolver.js';
import { detectTool } from '../../tools/tooling/utils.js';
import { resolveToolRoot } from '../../tools/shared/dict-utils.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

const toolRoot = resolveToolRoot();
const nestedRepo = resolveTestCachePath(toolRoot, 'nested-repository-command-authority');
fs.rmSync(nestedRepo, { recursive: true, force: true });
fs.mkdirSync(nestedRepo, { recursive: true });
const command = path.join(nestedRepo, process.platform === 'win32' ? 'fixture-command.cmd' : 'fixture-command');
fs.writeFileSync(command, 'inert marker; never executed');
const originalSpawn = childProcess.spawnSync;
const priorTrust = process.env.PAIROFCLEATS_TRUSTED_REPOS;
let launches = 0;
// Capture every would-be probe and return a controlled result. No marker,
// interpreter, vendor tool or repository program executes in this regression.
childProcess.spawnSync = () => {
  launches += 1;
  return { status: 0, signal: null, pid: null, stdout: Buffer.from('controlled version'), stderr: Buffer.from('') };
};
syncBuiltinESMExports();
try {
  process.env.PAIROFCLEATS_TRUSTED_REPOS = '[]';
  invalidateToolingCommandProbeCache({ providerId: 'fixture-nested', command });
  const profile = resolveToolingCommandProfile({ providerId: 'fixture-nested', cmd: command, repoRoot: nestedRepo });
  assert.equal(profile.resolved.mode, 'blocked', 'a clone nested in the install root is still a separate repository');
  assert.equal(profile.resolved.reason, 'untrusted-repository-command');
  assert.deepEqual(profile.probe.attempted, []);
  assert.equal(launches, 0);
  const detected = detectTool({ authorityRepoRoot: nestedRepo, detect: { cmd: command, args: ['--version'], binDirs: [] } });
  assert.equal(detected.source, 'blocked');
  assert.equal(launches, 0, 'installation detection cannot use a broader exception');

  const appCommand = path.join(toolRoot, 'tests/fixtures/lsp/bin/pyright-langserver');
  if (process.platform !== 'win32') {
    const alias = path.join(nestedRepo, 'app-looking-alias');
    fs.symlinkSync(appCommand, alias);
    const linked = resolveToolingCommandProfile({ providerId: 'fixture-alias', cmd: alias, repoRoot: nestedRepo });
    assert.equal(linked.resolved.mode, 'blocked', 'repository-owned symlinks cannot borrow an app target exception');
    const linkedDetected = detectTool({ authorityRepoRoot: nestedRepo, detect: { cmd: alias, args: ['--version'], binDirs: [] } });
    assert.equal(linkedDetected.source, 'blocked');
    assert.equal(launches, 0);
  }
  const app = resolveToolingCommandProfile({ providerId: 'fixture-app', cmd: appCommand, repoRoot: toolRoot });
  assert.notEqual(app.resolved.mode, 'blocked', 'the application can use its own package-owned tooling');
  assert.ok(launches > 0);
  const parent = resolveToolingCommandProfile({ providerId: 'fixture-parent', cmd: appCommand, repoRoot: path.dirname(toolRoot) });
  assert.notEqual(parent.resolved.mode, 'blocked', 'app-owned tools remain valid in an enclosing workspace');

  process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([nestedRepo]);
  const trusted = resolveToolingCommandProfile({ providerId: 'fixture-trusted', cmd: command, repoRoot: nestedRepo });
  assert.notEqual(trusted.resolved.mode, 'blocked', 'an exact launch-owned grant still permits the selected repository');
} finally {
  childProcess.spawnSync = originalSpawn;
  syncBuiltinESMExports();
  if (priorTrust === undefined) delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
  else process.env.PAIROFCLEATS_TRUSTED_REPOS = priorTrust;
  fs.rmSync(nestedRepo, { recursive: true, force: true });
}
console.log('Nested repositories do not inherit the application command exemption; app and exact user grants remain valid.');
