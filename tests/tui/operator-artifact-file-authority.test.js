import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { bindArtifactScope, createTuiArtifactRegistry } from '../../tools/tui/operator/artifact-registry.js';
import { createTuiArtifactActions } from '../../tools/tui/operator/artifacts.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';

// Real file/export and portable rejection controls create no filesystem aliases.
// Physical file/destination aliases retain their separate native coverage owner.
const { dir } = await prepareIsolatedTestCacheDir('artifact-file-authority');
const repo = path.join(dir, 'repository'), outside = path.join(dir, 'private');
await fs.mkdir(repo); await fs.mkdir(outside);
const source = path.join(repo, 'report.bin'), privateFile = path.join(outside, 'secret.bin');
await fs.writeFile(source, 'verified source'); await fs.writeFile(privateFile, 'private sentinel');
const registry = createTuiArtifactRegistry(), actions = createTuiArtifactActions({ registry, toolRoot: process.cwd() });
const generation = registry.beginJob('source');
const inventory = await registry.capture({ sourceJobId: 'source', generation, artifacts: [
  bindArtifactScope({ path: source }, { root: repo, repoRoot: repo })] });
const selection = { sourceJobId: 'source', inventoryId: inventory.inventoryId, artifactId: inventory.artifacts[0].artifactId };
const open = fs.open, lstat = fsSync.lstatSync, asyncLstat = fs.lstat;
let classifiedAlias = null, classificationReads = 0, payloadOpens = 0;
try {
  await actions.execute('export', { ...selection, confirmed: true, destination: 'export.bin' });
  assert.equal(await fs.readFile(path.join(repo, 'export.bin'), 'utf8'), 'verified source');
  await assert.rejects(actions.execute('export', { ...selection, confirmed: true,
    destination: path.join(outside, 'escaped.bin') }), { code: 'ERR_UNSAFE_FILE_PATH' });
  // Explicit filesystem-classification fault: exercise the actual operator's
  // containment refusal without representing this as a native-link proof.
  fsSync.lstatSync = function (filename, ...args) {
    if (classifiedAlias && path.resolve(filename) === classifiedAlias) {
      classificationReads++; return { isSymbolicLink: () => true };
    }
    return lstat.call(this, filename, ...args);
  };
  fs.lstat = async function (filename, ...args) {
    if (classifiedAlias && path.resolve(filename) === classifiedAlias) {
      classificationReads++; return { isSymbolicLink: () => true };
    }
    return asyncLstat.call(this, filename, ...args);
  };
  fs.open = async (...args) => { payloadOpens++; return open(...args); };
  classifiedAlias = source;
  await assert.rejects(actions.execute('copy', selection), { code: 'ERR_UNSAFE_FILE_PATH' });
  assert.equal(payloadOpens, 0, 'unsafe source classification refuses payload reads and command discovery');
  assert.ok(classificationReads > 0);
  const alias = path.join(repo, 'destination'); await fs.mkdir(alias);
  classifiedAlias = alias; classificationReads = 0;
  await assert.rejects(actions.execute('export', { ...selection, confirmed: true,
    destination: path.join(alias, 'export.bin') }), { code: 'ERR_UNSAFE_FILE_PATH' });
  assert.ok(classificationReads > 0);
  assert.deepEqual(await fs.readdir(alias), []);
  assert.deepEqual(await fs.readdir(outside), ['secret.bin']);
  assert.equal(await fs.readFile(privateFile, 'utf8'), 'private sentinel');
} finally { fs.open = open; fsSync.lstatSync = lstat; fs.lstat = asyncLstat; await actions.dispose(); await registry.dispose(); }
console.log('Portable artifact authority preserves real export and rejects escaped or alias-classified paths.');
