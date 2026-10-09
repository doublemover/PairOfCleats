#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyPatches } from '../../../tools/setup/apply-patches.js';
import { createPatchFixture, originalText, patchedText } from './patch-fixture.js';

const suite = path.join(process.cwd(), 'temp', 'tasks', 'multifile-patch');
await fs.mkdir(suite, { recursive: true });
const root = await fs.mkdtemp(path.join(suite, 'case-'));
const fixture = async name => createPatchFixture(path.join(root, name));
const addSecond = async value => {
  const second = path.join(path.dirname(value.target), 'second.txt');
  await fs.writeFile(second, originalText);
  await fs.writeFile(value.patchFile, value.patch + value.patch.replaceAll('source.txt', 'second.txt'));
  return second;
};
const clean = await fixture('clean');
const second = await addSecond(clean);
assert.equal(applyPatches(path.dirname(path.dirname(clean.patchFile))), 2);
assert.equal(await fs.readFile(clean.target, 'utf8'), patchedText);
assert.equal(await fs.readFile(second, 'utf8'), patchedText);
assert.equal(applyPatches(path.dirname(path.dirname(clean.patchFile))), 2);

const atomic = await fixture('atomic');
const bad = await addSecond(atomic);
await fs.writeFile(bad, 'incompatible\n');
assert.throws(() => applyPatches(path.dirname(path.dirname(atomic.patchFile))), /not fully applied/);
assert.equal(await fs.readFile(atomic.target, 'utf8'), originalText);
for (const [name, transform, expected] of [
  ['duplicate', value => value.patch + value.patch, /Multiple patches target/],
  ['cross-package', value => value.patch + value.patch.replaceAll('node_modules/sample/', 'node_modules/other/'), /malformed existing-file/],
  ['outside', value => value.patch.replaceAll(value.relative, 'node_modules/sample/../../escape'), /Unsafe patch path/],
  ['new-file', value => value.patch.replaceAll('source.txt', 'absent.txt'), /ENOENT/],
  ['rename', value => value.patch.replace('+++ b/', '+++ b/renamed/'), /malformed existing-file/],
  ['file-cap', value => Array.from({ length: 17 }, (_, i) => value.patch.replaceAll('source.txt', `file${i}.txt`)).join(''), /file section limit/]
]) {
  const value = await fixture(name);
  await fs.writeFile(value.patchFile, transform(value));
  assert.throws(() => applyPatches(path.dirname(path.dirname(value.patchFile))), expected);
  assert.equal(await fs.readFile(value.target, 'utf8'), originalText);
}
const nonregular = await fixture('nonregular');
await fs.rename(nonregular.target, nonregular.target + '.preserved');
await fs.mkdir(nonregular.target);
assert.throws(() => applyPatches(path.dirname(path.dirname(nonregular.patchFile))), /regular unlinked file/);
console.log('Bounded multi-file package patch safety test passed');
