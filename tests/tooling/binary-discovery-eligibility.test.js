import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { candidateNames, createBinaryDiscovery, findBinaryInDirs, classifyBinaryDiscoverySelection } from '../../src/index/tooling/binary-utils.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';

const root = await makeTempDir('binary-eligibility-'), bad = path.join(root, 'bad'), good = path.join(root, 'good');
await fsp.mkdir(bad); await fsp.mkdir(good);
const name = 'authored-discovery', filename = candidateNames(name)[0], rejected = path.join(bad, filename), eligible = path.join(good, filename);
await fsp.mkdir(rejected); await fsp.writeFile(eligible, 'inert fixture; never launched');
if (process.platform !== 'win32') await fsp.chmod(eligible, 0o755);
const original = { lstat: fs.lstatSync, stat: fs.statSync, realpath: fs.realpathSync, access: fs.accessSync };
try {
  const discovery = createBinaryDiscovery();
  assert.equal(discovery.findInDirs(name, [bad, good]), eligible);
  assert.ok(discovery.getReceipt().observations.some(value => value.path === rejected && value.reason === 'not-file'));
  assert.equal(discovery.getReceipt().selected.targetPath, original.realpath(eligible));
  assert.equal(discovery.findInDirs(rejected, [good]), null, 'explicit paths cannot substitute an ambient candidate');
  await fsp.rmdir(rejected); await fsp.writeFile(rejected, 'replacement');
  if (process.platform !== 'win32') await fsp.chmod(rejected, 0o755);
  assert.equal(findBinaryInDirs(name, [bad, good]), rejected, 'a fresh attempt observes directory replacement');
  if (process.platform !== 'win32') {
    await fsp.chmod(rejected, 0o644);
    const denied = createBinaryDiscovery(); assert.equal(denied.findInDirs(name, [bad, good]), eligible);
    assert.ok(denied.getReceipt().observations.some(value => value.reason === 'not-executable'));
    await fsp.chmod(rejected, 0o755); assert.equal(findBinaryInDirs(name, [bad, good]), rejected);
  }
  {
    let stats = 0, access = 0;
    fs.lstatSync = (...args) => { stats++; return original.lstat(...args); };
    fs.accessSync = (...args) => { access++; return original.access(...args); };
    const scoped = createBinaryDiscovery(); scoped.observe(eligible); scoped.observe(eligible);
    assert.equal(stats, 1, 'stat/realpath observations are shared only within this attempt');
    if (process.platform === 'win32') assert.equal(access, 0, 'Windows launch eligibility does not pretend X_OK is a permission check');
    fs.lstatSync = original.lstat; fs.accessSync = original.access;
  }
  // Metadata injection exercises link authority without creating links or
  // requiring Windows privileges. No native launch/physical-link pass is claimed.
  const link = path.join(root, filename), linkStats = { isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false };
  let target = 'file';
  fs.lstatSync = (file, ...args) => path.resolve(file) === link ? linkStats : original.lstat(file, ...args);
  fs.statSync = (file, ...args) => {
    if (path.resolve(file) !== link) return original.stat(file, ...args);
    if (target === 'missing') throw Object.assign(new Error('absent target'), { code: 'ENOENT' });
    return original.stat(target === 'directory' ? good : eligible, ...args);
  };
  fs.realpathSync = (file, ...args) => path.resolve(file) === link ? eligible : original.realpath(file, ...args);
  const linked = createBinaryDiscovery().observe(link);
  assert.equal(linked.pathKind, 'symlink'); assert.equal(linked.targetKind, 'file'); assert.equal(linked.targetPath, eligible);
  target = 'directory'; assert.equal(createBinaryDiscovery().observe(link).reason, 'not-file');
  target = 'missing'; assert.equal(createBinaryDiscovery().observe(link).reason, 'broken-link');
  fs.statSync = original.stat; fs.realpathSync = original.realpath;
  let attempts = 0;
  fs.lstatSync = () => { attempts++; throw Object.assign(new Error('read denied'), { code: 'EACCES' }); };
  const unknown = createBinaryDiscovery(); assert.equal(unknown.findInDirs(name, [bad]), null);
  assert.equal(unknown.getReceipt().status, 'unknown'); assert.ok(unknown.getReceipt().observations.every(value => value.reason === 'inaccessible-or-unknown'));
  fs.lstatSync = (file, ...args) => {
    if (path.resolve(file).startsWith(bad + path.sep)) throw Object.assign(new Error('first scope denied'), { code: 'EACCES' });
    return original.lstat(file, ...args);
  };
  const later = createBinaryDiscovery(); assert.equal(later.findInDirs(name, [bad, good]), eligible);
  assert.ok(later.getReceipt().unknownCandidates > 0);
  attempts = 0;
  fs.lstatSync = () => { attempts++; throw Object.assign(new Error('read denied'), { code: 'EACCES' }); };
  const bounded = createBinaryDiscovery(); bounded.findInDirs(name, Array.from({ length: 5000 }, (_, index) => path.join(root, String(index))));
  assert.equal(attempts, 4096); assert.equal(bounded.getReceipt().observations.length, 64);
  assert.equal(bounded.getReceipt().exhausted, true); assert.equal(bounded.getReceipt().status, 'unknown');
  fs.lstatSync = original.lstat;
  const empty = createBinaryDiscovery(); assert.equal(empty.findOnPath(name, ''), null);
  assert.equal(empty.getReceipt().pathSearchState, 'empty'); assert.equal(empty.getReceipt().status, 'unknown');
  assert.equal(classifyBinaryDiscoverySelection(null, empty.getReceipt()), 'unknown');
  assert.equal(classifyBinaryDiscoverySelection(null, { status: 'no-eligible-candidate', examinedCandidates: 80, knownMissingCandidates: 79,
    observations: Array(64).fill({ reason: 'not-found' }) }), 'ineligible', 'truncated diagnostics cannot erase a later known directory');
  if (process.platform === 'win32') {
    assert.deepEqual(candidateNames('named.EXE'), ['named.EXE']);
    for (const extension of ['.exe', '.cmd', '.bat']) {
      const file = path.join(root, `windows-kind${extension}`); await fsp.writeFile(file, 'inert');
      assert.equal(createBinaryDiscovery().observe(file).launchKind, extension === '.exe' ? 'windows-native' : 'windows-cmd');
    }
  }
} finally {
  fs.lstatSync = original.lstat; fs.statSync = original.stat; fs.realpathSync = original.realpath; fs.accessSync = original.access;
  await rmDirRecursive(root);
}
console.log('Binary discovery distinguishes candidate kind, launch eligibility, unknown scope and exact attempt-owned observations.');
