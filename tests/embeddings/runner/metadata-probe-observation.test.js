import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { parse } from 'acorn';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { errorGraphSome } from '../../helpers/error-graph.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('embeddings/runner/metadata-probe-observation/')[1];
assert.ok(['path-presence', 'artifact-variants', 'generation-inventory-and-stat', 'maintenance-size'].includes(mode));
const source = await fs.readFile(new URL('../../../tools/build/embeddings/runner.js', import.meta.url), 'utf8');
const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const find = name => {
  const pending = [tree];
  while (pending.length) {
    const node = pending.pop(); if (!node || typeof node !== 'object') continue;
    if (node.type === 'VariableDeclarator' && node.id.name === name) return node.init;
    for (const value of Object.values(node)) if (Array.isArray(value)) pending.push(...value); else if (value && typeof value === 'object') pending.push(value);
  }
  assert.fail('Missing original runner probe: ' + name);
};
const load = (name, bindings) => {
  const node = find(name); return vm.runInNewContext('(' + source.slice(node.start, node.end) + ')', { path, observeStorageResource, ...bindings });
};
const ownerModel = () => {
  let ready = false, codeReads = 0;
  const primary = new Error('original metadata work remains outstanding');
  Object.defineProperties(primary, { cacheOwnershipReleased: { value() { assert.equal(this, primary); return ready; } },
    code: { get() { codeReads++; ready = true; return 'ENOENT'; } } }); Object.freeze(primary);
  return { primary, get codeReads() { return codeReads; }, release() { ready = true; } };
};
const rejectsOriginal = async (action, owner) => {
  let failure;
  try { await action(); assert.fail('unknown work must not become absent metadata'); } catch (error) { failure = error; }
  assert.ok(errorGraphSome(failure, value => value === owner.primary)); assert.equal(owner.codeReads, 0);
  assert.equal(failure.cacheOwnershipReleased(), false); owner.release(); assert.equal(failure.cacheOwnershipReleased(), true);
};
const scope = path.resolve('.tmp', 'tasks', 'embedding-metadata-observations'); await fs.mkdir(scope, { recursive: true });
const root = await fs.mkdtemp(path.join(scope, 'case-')), marker = randomUUID();
await fs.writeFile(path.join(root, '.owned-test-fixture'), marker);
try {
  const file = path.join(root, 'input'); await fs.writeFile(file, 'abc');
  if (mode === 'path-presence') {
    const probe = load('pathExists', { fs });
    assert.equal(await probe(file), true); assert.equal(await probe(path.join(root, 'missing')), false); assert.equal(await probe(null), false);
    const ordinary = load('pathExists', { fs: { access: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } } });
    assert.equal(await ordinary(file), false);
    const owner = ownerModel(), pending = load('pathExists', { fs: { access: async () => { throw owner.primary; } } });
    await rejectsOriginal(() => pending(file), owner);
  } else if (mode === 'artifact-variants') {
    const base = path.join(root, 'artifact'); await fs.writeFile(base + '.gz', 'compressed fixture bytes');
    const probe = load('hasArtifactFile', { fs });
    assert.equal(await probe(base), true); assert.equal(await probe(base + '-missing'), false);
    const owner = ownerModel(); let calls = 0;
    const pending = load('hasArtifactFile', { fs: { access: async () => { calls++; throw owner.primary; } } });
    await rejectsOriginal(() => pending(base), owner); assert.equal(calls, 1, 'uncertain primary access cannot advance to a backup/compressed variant');
  } else if (mode === 'maintenance-size') {
    const probe = load('safeStatSize', { fs });
    assert.equal(await probe(file), 3); assert.equal(await probe(root), null); assert.equal(await probe(file + '-missing'), null);
    const owner = ownerModel(), pending = load('safeStatSize', { fs: { stat: async () => { throw owner.primary; } } });
    await rejectsOriginal(() => pending(file), owner);
  } else {
    const builds = path.join(root, 'builds'); await fs.mkdir(builds);
    for (const [name, time] of [['older', 1000], ['newer', 2000]]) { const dir = path.join(builds, name); await fs.mkdir(dir); await fs.utimes(dir, time, time); }
    const common = { repoCacheRootResolved: root, primaryMode: 'code', pathExists: load('pathExists', { fs }), hasModeArtifacts: async () => true };
    const probe = load('findLatestModeRoot', { ...common, fs });
    assert.equal(await probe(), path.join(builds, 'newer'));
    for (const failureAt of ['readdir', 'stat']) {
      const owner = ownerModel(), mocked = { readdir: fs.readdir, stat: fs.stat,
        [failureAt]: async () => { throw owner.primary; } };
      const pending = load('findLatestModeRoot', { ...common, fs: mocked });
      await rejectsOriginal(() => pending(), owner);
    }
  }
} finally {
  const physicalScope = await fs.realpath(scope), physicalRoot = await fs.realpath(root);
  assert.ok(isPathWithinRoot(physicalRoot, physicalScope) && physicalRoot !== physicalScope);
  assert.equal(await fs.readFile(path.join(physicalRoot, '.owned-test-fixture'), 'utf8'), marker);
  await fs.rm(physicalRoot, { recursive: true, force: true });
}
console.log('Original runner metadata probes preserve native observations before ordinary fallback.');
