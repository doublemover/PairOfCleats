import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { detectTool, getToolingRegistry } from '../../../tools/tooling/utils.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { withTemporaryEnv, ensureTestingEnv } from '../../helpers/test-env.js';
import { isApplicationOwnedCommand } from '../../../src/shared/config-authority.js';
import { probeLspInitializeHandshake } from '../../../src/index/tooling/command-resolver.js';

ensureTestingEnv(process.env);
const root = process.cwd();
const { dir } = await prepareIsolatedTestCacheDir('application-owned-node-detect');
const applicationBin = path.join(root, 'node_modules/.bin');
const nodeDirectory = path.dirname(process.execPath);
const pyright = (toolingRoot, repoRoot) => getToolingRegistry(toolingRoot, repoRoot).find(tool => tool.id === 'pyright');
const makeProvider = async (bin, marker) => {
  await fs.mkdir(bin, { recursive: true });
  const script = path.join(bin, 'repo-provider.cjs');
  await fs.writeFile(script, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'executed');process.exit(0);\n`);
  const command = path.join(bin, process.platform === 'win32' ? 'pyright-langserver.cmd' : 'pyright-langserver');
  if (process.platform === 'win32') await fs.writeFile(command, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  else { await fs.copyFile(script, command); await fs.chmod(command, 0o755); }
};
await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]', PATH: nodeDirectory, Path: nodeDirectory }, async () => {
  assert.equal(isApplicationOwnedCommand({ commandPath: applicationBin, repoRoot: root, toolRoot: root }), true);
  const fresh = pyright(path.join(dir, 'fresh-cache'), root);
  assert.ok(fresh.detect.binDirs.includes(applicationBin),
    'an application-owned bundled dependency must not require repository execution trust');
  const result = detectTool(fresh);
  assert.equal(result.found, true, JSON.stringify(result.probe));
  const expected = path.join(applicationBin, process.platform === 'win32' ? 'pyright-langserver.cmd' : 'pyright-langserver');
  assert.equal(await fs.realpath(result.path), await fs.realpath(expected));
  if (result.probe.attempts.some(attempt => attempt.status !== 0)) {
    assert.equal(result.probe.acceptance, 'recognized-transport-usage');
    assert.ok(result.probe.attempts.some(attempt => attempt.status === 1 && attempt.stderrExcerpt.includes('createConnection')),
      'recognized usage remains an explicit nonzero witness, never fabricated exit-zero evidence');
  }
  const handshake = await probeLspInitializeHandshake({ providerId: 'pyright', cmd: result.path,
    args: ['--stdio'], cwd: dir, timeoutMs: 4000 });
  assert.equal(handshake.ok, true, JSON.stringify(handshake));
  assert.equal(handshake.capabilityEvidence, 'initialize-advertisement');
  assert.equal(handshake.capabilities.documentSymbol, true);
  console.log(JSON.stringify({ actualInstalledPyright: result.path, handshake }));

  const stale = pyright(path.join(dir, 'stale-cache'), root);
  const staleMarker = path.join(dir, 'stale-provider-executed');
  await makeProvider(stale.detect.binDirs.find(bin => bin !== applicationBin), staleMarker);
  const staleResult = detectTool(stale);
  assert.equal(staleResult.found, true);
  assert.equal(await fs.realpath(staleResult.path), await fs.realpath(expected));
  await assert.rejects(fs.access(staleMarker), { code: 'ENOENT' }, 'an old cache cannot shadow the selected bundled dependency');

  const child = path.join(dir, 'untrusted-child'), childBin = path.join(child, 'node_modules/.bin');
  const marker = path.join(dir, 'repo-command-executed');
  await makeProvider(childBin, marker);
  assert.equal(isApplicationOwnedCommand({ commandPath: childBin, repoRoot: child, toolRoot: root }), false);
  const untrusted = pyright(path.join(dir, 'child-cache'), child);
  assert.equal(untrusted.detect.binDirs.includes(childBin), false);
  assert.equal(untrusted.detect.binDirs.includes(applicationBin), false, 'an indexed child cannot inherit the enclosing application authority');
  assert.equal(detectTool(untrusted).found, false);
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([child]) }, async () => {
    const trusted = detectTool(pyright(path.join(dir, 'child-cache'), child));
    assert.equal(trusted.found, true, JSON.stringify(trusted.probe));
    assert.equal(await fs.readFile(marker, 'utf8'), 'executed');
  });
});
console.log('Bundled Node provider detection reuses application authority while preserving untrusted child boundaries');
