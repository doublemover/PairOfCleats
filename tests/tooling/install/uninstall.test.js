#!/usr/bin/env node
import { resolveDevelopmentArtifactPath } from '../../../tools/shared/dev-artifacts.js';
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { setupToolingInstallWorkspace } from '../../helpers/tooling-install-fixture.js';
import { assertSafeCacheDeletion, CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';

applyTestEnv();
const {
  root,
  tempRoot: baseDir,
  repoRoot: repoDir,
  cacheRoot
} = await setupToolingInstallWorkspace('uninstall');
const dictDir = path.join(cacheRoot, 'dictionaries');
const modelsDir = path.join(cacheRoot, 'models');
const appDataRoot = path.join(baseDir, 'LocalAppData');
const defaultCacheRoot = path.join(appDataRoot, 'PairOfCleats');
const extensionsDir = path.join(defaultCacheRoot, 'extensions');

await fsPromises.mkdir(dictDir, { recursive: true });
await fsPromises.mkdir(modelsDir, { recursive: true });
await fsPromises.mkdir(extensionsDir, { recursive: true });
await fsPromises.mkdir(path.join(defaultCacheRoot, 'cache'), { recursive: true });
for (const ownedRoot of [cacheRoot, defaultCacheRoot]) {
  await fsPromises.writeFile(path.join(ownedRoot, CACHE_OWNER_FILE),
    JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
}

await fsPromises.writeFile(
  path.join(repoDir, '.pairofcleats.json'),
  JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2)
);

await fsPromises.writeFile(path.join(cacheRoot, 'marker.txt'), 'cache');
await fsPromises.writeFile(path.join(dictDir, 'dict.txt'), 'dict');
await fsPromises.writeFile(path.join(modelsDir, 'model.bin'), 'model');
await fsPromises.writeFile(path.join(extensionsDir, 'vec0.dll'), 'ext');

const env = applyTestEnv({
  extraEnv: {
    LOCALAPPDATA: appDataRoot,
    PAIROFCLEATS_CACHE_ROOT: null,
    PAIROFCLEATS_TRUSTED_CONFIG: null,
    PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repoDir])
  }
});

assert.equal(path.resolve(baseDir), resolveDevelopmentArtifactPath(root, 'test-cache', 'uninstall'));
const uninstallScript = path.join(root, 'tools', 'tooling', 'uninstall.js');
const preview = runNode([uninstallScript, '--dry-run', '--yes', '--repo', repoDir],
  'tooling uninstall preview', repoDir, env, { stdio: 'pipe', timeoutMs: 10000 });
const deletionTargets = [...String(preview.stderr || '').matchAll(/^dry-run: would delete (.+)$/gmu)]
  .map(match => path.resolve(match[1]));
assert.ok(deletionTargets.length >= 3, 'expected disposable cache, dictionary and extension deletion targets');
for (const target of deletionTargets) {
  assert.ok(isPathWithinRoot(target, baseDir) && target !== path.resolve(baseDir),
    `uninstall target must stay inside the disposable fixture: ${target}`);
  assertSafeCacheDeletion(target, [cacheRoot, defaultCacheRoot]);
}

const result = runNode(
  [uninstallScript, '--yes', '--repo', repoDir],
  'tooling uninstall',
  repoDir,
  env,
  { stdio: 'inherit' }
);

if (result.status !== 0) {
  console.error('Uninstall test failed: script exited with non-zero status.');
  process.exit(result.status ?? 1);
}

const exists = (target) => fs.existsSync(target);
const failures = [];
if (exists(cacheRoot)) failures.push(`cache root still exists: ${cacheRoot}`);
if (exists(dictDir)) failures.push(`dict dir still exists: ${dictDir}`);
if (exists(modelsDir)) failures.push(`models dir still exists: ${modelsDir}`);
if (exists(extensionsDir)) failures.push(`extensions dir still exists: ${extensionsDir}`);

if (failures.length) {
  failures.forEach((msg) => console.error(msg));
  process.exit(1);
}

console.log('Uninstall test passed');
