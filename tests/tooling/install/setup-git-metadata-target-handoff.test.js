import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { Writable } from 'node:stream';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { initGitRepo, runGit } from '../../helpers/git-fixture.js';
import { getIndexDir, getRepoCacheRoot, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/setup-git-metadata-target-handoff/')[1];
assert.ok(['worktree', 'submodule'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir('setup-git-metadata-' + selected);
const launchingCwd = process.cwd(), applicationRoot = toRealPathSync(launchingCwd), parent = path.join(dir, 'parent repository');
const target = selected === 'worktree' ? path.join(dir, 'selected worktree') : path.join(parent, 'modules/selected child');
const cache = path.join(dir, 'selected cache'), parentCache = path.join(dir, 'parent cache');
const withinFixture = candidate => {
  const relative = path.relative(path.resolve(dir), path.resolve(candidate));
  assert.ok(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep),
    'cleanup and Git metadata targets must remain in the original task-owned fixture directory');
};
withinFixture(parent); withinFixture(target); withinFixture(cache); withinFixture(parentCache);
let state, hook;
const argv = process.argv, log = console.log, error = console.error, warn = console.warn, exit = process.exitCode;
const stdoutDescriptor = Object.getOwnPropertyDescriptor(process, 'stdout');
try {
  await fs.mkdir(parent, { recursive: true }); initGitRepo(parent);
  await fs.writeFile(path.join(parent, 'parent.txt'), 'original parent content');
  await fs.writeFile(path.join(parent, '.pairofcleats.json'), JSON.stringify({ cache: { root: parentCache } }));
  runGit(['add', '.'], { cwd: parent }); runGit(['commit', '-m', 'test parent'], { cwd: parent });
  if (selected === 'worktree') {
    // This is disposable runtime input, never an implementation checkout.
    runGit(['worktree', 'add', '--detach', target, 'HEAD'], { cwd: parent });
  } else {
    const source = path.join(dir, 'local submodule source'); withinFixture(source);
    await fs.mkdir(source); initGitRepo(source);
    await fs.writeFile(path.join(source, 'child.txt'), 'original submodule content');
    runGit(['add', '.'], { cwd: source }); runGit(['commit', '-m', 'test child'], { cwd: source });
    // Local transport is enabled for this one test-owned operation only.
    runGit(['-c', 'protocol.file.allow=always', 'submodule', 'add', '--', source, 'modules/selected child'], { cwd: parent });
    runGit(['commit', '-am', 'test submodule membership'], { cwd: parent });
    assert.equal(toRealPathSync(runGit(['rev-parse', '--show-superproject-working-tree'], { cwd: target }).stdout.trim()),
      toRealPathSync(parent));
  }
  assert.equal((await fs.lstat(path.join(target, '.git'))).isFile(), true, 'exercise actual Git metadata files rather than a synthetic ordinary directory');
  assert.equal(toRealPathSync(runGit(['rev-parse', '--show-toplevel'], { cwd: target }).stdout.trim()), toRealPathSync(target));
  await fs.writeFile(path.join(target, '.pairofcleats.json'), JSON.stringify({ cache: { root: cache } }));
  const parentConfig = await fs.readFile(path.join(parent, '.pairofcleats.json'), 'utf8');
  applyTestEnv({ testConfig: null, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null,
    PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([parent, target]), PAIROFCLEATS_CACHE_ROOT: null } });
  const canonicalTarget = toRealPathSync(target);
  const selectedIndex = getIndexDir(target, 'code', loadUserConfig(target));
  const enclosingIndex = getIndexDir(parent, 'code', loadUserConfig(parent));
  withinFixture(selectedIndex); withinFixture(enclosingIndex);
  assert.notEqual(getRepoCacheRoot(target, loadUserConfig(target)), getRepoCacheRoot(parent, loadUserConfig(parent)));
  // Existing healthy parent artifacts must never qualify the selected target.
  await fs.mkdir(enclosingIndex, { recursive: true });
  await fs.writeFile(path.join(enclosingIndex, 'chunk_meta.json'), '[{"parentOnly":true}]');
  globalThis.__setupMetadataChild = async (command, args, options) => {
    assert.equal(command, process.execPath); state.calls.push([...args]);
    assert.equal(args[args.indexOf('--repo') + 1], canonicalTarget);
    assert.equal(options.cwd, canonicalTarget); assert.ok(options.signal instanceof AbortSignal);
    assert.equal(process.cwd(), launchingCwd, 'setup must not globally change the launching directory');
    assert.equal(loadUserConfig(canonicalTarget).cache.root, cache);
    const build = args[0].endsWith('build_index.js');
    if (state.branch === 'foreign-output') return { ok: true, status: 0, stdout: '', stderr: '' };
    if (state.branch === 'recovery' && build && ++state.builds === 1) return { ok: false, status: 1 };
    await fs.mkdir(selectedIndex, { recursive: true }); await fs.writeFile(path.join(selectedIndex, 'chunk_meta.json'), '[]');
    return { ok: true, status: 0, stdout: '', stderr: '' };
  };
  hook = registerHooks({ load(url, context, next) {
    if (url.endsWith('/tools/setup/owned-command.js')) return { format: 'module', shortCircuit: true,
      source: 'export const runSetupCommand=(...args)=>globalThis.__setupMetadataChild(...args);' };
    return next(url, context);
  } });
  console.log = console.error = console.warn = () => {};
  for (const alias of ['--repo', '--root']) for (const branch of ['initial', 'recovery', 'restore', 'stage4', 'foreign-output']) {
    state = { branch, calls: [], builds: 0 }; const output = [];
    Object.defineProperty(process, 'stdout', { configurable: true, value: new Writable({
      write(chunk, _encoding, callback) { output.push(String(chunk)); callback(); }
    }) });
    withinFixture(selectedIndex); await fs.rm(selectedIndex, { recursive: true, force: true });
    if (branch === 'stage4') { await fs.mkdir(selectedIndex, { recursive: true }); await fs.writeFile(path.join(selectedIndex, 'chunk_meta.json'), '[]'); }
    if (branch === 'restore') {
      await fs.mkdir(path.join(target, 'ci-artifacts'), { recursive: true });
      await fs.writeFile(path.join(target, 'ci-artifacts/manifest.json'), '{}');
    }
    process.argv = [argv[0], 'setup.js', alias, target, '--non-interactive', '--json', '--skip-install', '--skip-dicts',
      '--skip-models', '--skip-extensions', '--skip-tooling', '--with-sqlite', ...(branch === 'restore' ? [] : ['--skip-artifacts']),
      ...(branch === 'stage4' ? ['--skip-index'] : [])];
    await import(new URL('../../../tools/setup/setup.js?metadata=' + selected + '-' + alias + '-' + branch, import.meta.url));
    const summary = JSON.parse(output.join(''));
    assert.equal(summary.root, canonicalTarget); assert.equal(summary.steps.index.ready, branch !== 'foreign-output');
    assert.equal(summary.steps.install.targetRoot, canonicalTarget); assert.equal(toRealPathSync(summary.steps.install.toolRoot), applicationRoot);
    assert.equal(state.calls.filter(args => args[0].endsWith('build_index.js')).length,
      branch === 'restore' ? 1 : ['recovery', 'foreign-output'].includes(branch) ? 2 : 1);
    if (branch === 'initial') assert.equal(state.calls.some(args => args.includes('--stage')), false);
    if (branch === 'stage4' || branch === 'restore') {
      const stage4 = state.calls.find(args => args.includes('--stage'));
      assert.ok(stage4); assert.equal(stage4[stage4.indexOf('--stage') + 1], '4');
    }
    if (branch === 'restore') assert.equal(state.calls.filter(args => args[0].endsWith('restore-artifacts.js')).length, 1);
    assert.equal(await fs.readFile(path.join(parent, '.pairofcleats.json'), 'utf8'), parentConfig);
    assert.equal(await fs.readFile(path.join(enclosingIndex, 'chunk_meta.json'), 'utf8'), '[{"parentOnly":true}]');
    process.exitCode = exit;
  }
} finally {
  process.argv = argv; console.log = log; console.error = error; console.warn = warn; process.exitCode = exit;
  Object.defineProperty(process, 'stdout', stdoutDescriptor); hook?.deregister(); delete globalThis.__setupMetadataChild;
  // Verify all recursive-removal/metadata targets before touching either one.
  withinFixture(parent); withinFixture(target);
  if (selected === 'worktree' && await fs.stat(path.join(target, '.git')).then(() => true, () => false)) {
    runGit(['worktree', 'remove', '--force', target], { cwd: parent });
  }
  const relative = path.relative(applicationRoot, dir);
  assert.ok(relative.startsWith('.tmp' + path.sep), 'fixture cleanup must stay under the authorized checkout test cache');
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Actual ' + selected + ' setup retains selected root/config/cache/readiness through both aliases and every build/restore branch.');
