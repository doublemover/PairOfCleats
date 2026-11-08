import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { bindArtifactScope, createTuiArtifactRegistry } from '../../tools/tui/operator/artifact-registry.js';
import { createTuiArtifactActions } from '../../tools/tui/operator/artifacts.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';

// Actual file symlinks are required on Windows. EPERM is a qualification
// blocker, never a skip or a request to substitute directory junctions.
const { dir } = await prepareIsolatedTestCacheDir('artifact-file-authority');
const repo = path.join(dir, 'repository'), outside = path.join(dir, 'private');
await fs.mkdir(repo); await fs.mkdir(outside);
const source = path.join(repo, 'report.bin'), privateFile = path.join(outside, 'secret.bin');
await fs.writeFile(source, 'verified source'); await fs.writeFile(privateFile, 'private sentinel');
const registry = createTuiArtifactRegistry(), actions = createTuiArtifactActions({ registry, toolRoot: process.cwd() });
const generation = registry.beginJob('source');
const snapshot = async () => {
  const inventory = await registry.capture({ sourceJobId: 'source', generation, artifacts: [
    bindArtifactScope({ path: source }, { root: repo, repoRoot: repo })] });
  return { sourceJobId: 'source', inventoryId: inventory.inventoryId, artifactId: inventory.artifacts[0].artifactId };
};
let open = fs.open;
try {
  let selection = await snapshot();
  await fs.unlink(source); await fs.symlink(privateFile, source, 'file');
  let payloadOpens = 0;
  fs.open = async (...args) => { payloadOpens++; return open(...args); };
  await assert.rejects(actions.execute('copy', selection), { code: 'ERR_UNSAFE_FILE_PATH' });
  assert.equal(payloadOpens, 0, 'reject a replaced file link before opening any payload or spawning a clipboard command');
  fs.open = open;
  await fs.unlink(source); await fs.writeFile(source, 'fresh verified source'); selection = await snapshot();
  const alias = path.join(repo, 'destination');
  await fs.symlink(outside, alias, 'dir');
  await assert.rejects(actions.execute('export', { ...selection, confirmed: true,
    destination: path.join(alias, 'export.bin') }), { code: 'ERR_UNSAFE_FILE_PATH' });
  assert.deepEqual(await fs.readdir(outside), ['secret.bin']);
  assert.equal(await fs.readFile(privateFile, 'utf8'), 'private sentinel');
} finally { fs.open = open; await actions.dispose(); await registry.dispose(); }
console.log('artifact file and destination link authority passed');
