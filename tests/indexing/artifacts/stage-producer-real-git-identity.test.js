import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { stableStringifyForSignature } from '../../../src/shared/stable-json.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';
import { SIGNATURE_VERSION } from '../../../src/index/build/indexer/signatures.js';

const { dir } = await prepareIsolatedTestCacheDir('stage-producer-git-identity');
const root = path.join(dir, 'producer with spaces');
const selected = ['src', 'bin', 'tools', 'rules', 'patches', 'package.json', 'package-lock.json'];
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' });
const git = (...args) => execFileSync('git', ['--no-pager', '--no-replace-objects', '-C', root, ...args], {
  encoding: 'utf8', env, windowsHide: true
});
const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const hash = value => sha(stableStringifyForSignature(value));
const state = { root, commands: [], beforeRead: null, afterRead: null, afterGit: null, active: 0, peak: 0 };
globalThis.__producerRealGit = state;
const runnerUrl = new URL('../../../src/shared/subprocess/runner.js', import.meta.url).href;
const readerUrl = new URL('../../../src/shared/contained-file.js', import.meta.url).href;
const modules = {
  url: 'export const fileURLToPath=()=>globalThis.__producerRealGit.root;',
  runner: 'import {spawnSubprocess as actual} from ' + JSON.stringify(runnerUrl) + ';'
    + 'export const spawnSubprocess=async(command,args,options)=>{const s=globalThis.__producerRealGit;'
    + 's.commands.push([...args]);const result=await actual(command,args,options);'
    + 'if(s.afterGit)await s.afterGit(args,result);return result;};',
  reader: 'import {readVerifiedContainedFile as actual} from ' + JSON.stringify(readerUrl) + ';'
    + 'export const readVerifiedContainedFile=async(...args)=>{const s=globalThis.__producerRealGit;'
    + 's.active++;s.peak=Math.max(s.peak,s.active);try{if(s.beforeRead)await s.beforeRead(...args);'
    + 'const result=await actual(...args);if(s.afterRead)await s.afterRead(...args);'
    + 'return result;}finally{s.active--;}};'
};
const hooks = registerHooks({ resolve(specifier, context, next) {
  const resolved = next(specifier, context);
  if (context.parentURL?.includes('/src/index/build/stage-provenance.js')) {
    const key = specifier === 'node:url' ? 'url' : resolved.url === runnerUrl ? 'runner'
      : resolved.url === readerUrl ? 'reader' : null;
    if (key) return { url: 'producer-real-git:' + key, shortCircuit: true };
  }
  return resolved;
}, load(url, context, next) {
  if (url.startsWith('producer-real-git:')) return { format: 'module', shortCircuit: true,
    source: modules[url.slice('producer-real-git:'.length)] };
  return next(url, context);
} });
try {
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
  // Copy actual receipt bytes only as producer-hash input; this fixture does not
  // claim a prepared installation in its isolated Git repository.
  await fs.copyFile(new URL('../../../node_modules/.pairofcleats-bootstrap.json', import.meta.url),
    path.join(root, 'node_modules/.pairofcleats-bootstrap.json'));
  await fs.writeFile(path.join(root, '.gitignore'), 'node_modules/\n');
  for (const name of ['fixed.js', 'delete.js', 'rename-old.js', 'second.js']) {
    await fs.writeFile(path.join(root, 'src', name), 'export const value = ' + JSON.stringify(name) + ';\n');
  }
  git('init', '--quiet'); git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'Producer Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('add', '.'); git('commit', '--quiet', '-m', 'original producer files');
  const { observeStageProducer } = await import('../../../src/index/build/stage-provenance.js?real-git-identity');
  let originalDirtyInventory = [];
  const oracle = async () => {
    // Independent old inventory: real diff HEAD plus real ls-files, never the
    // new porcelain parser or its list of untracked files.
    const tracked = git('diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', 'HEAD', '--', ...selected);
    const untracked = git('ls-files', '--others', '--exclude-standard', '-z', '--', ...selected);
    const dirty = [];
    for (const relative of [...new Set((tracked + untracked).split('\0').filter(Boolean))].sort()) {
      try {
        const buffer = await fs.readFile(path.join(root, relative));
        dirty.push({ path: relative, bytes: buffer.length, hash: sha(buffer) });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        dirty.push({ path: relative, missing: true });
      }
    }
    originalDirtyInventory = dirty;
    const value = { schemaVersion: 1, revision: git('rev-parse', '--verify', 'HEAD').trim(),
      dirty: hash(dirty), dirtyFiles: dirty.length,
      bootstrap: sha(await fs.readFile(path.join(root, 'node_modules/.pairofcleats-bootstrap.json'))),
      node: process.version, signatureVersion: SIGNATURE_VERSION, analysisVersions: SEMANTIC_ANALYSIS_VERSIONS,
      evidenceScope: 'observed-implementation-files-and-bootstrap-receipt' };
    return { ...value, identity: hash(value) };
  };
  const assertObservation = async expectedProcesses => {
    state.commands.length = 0; state.peak = 0;
    const actual = await observeStageProducer();
    assert.deepEqual(actual, await oracle(), 'producer identity must exactly equal the independent original Git/content oracle');
    assert.equal(state.commands.length, expectedProcesses);
    assert.equal(state.commands.filter(args => args.includes('status')).length, 2);
    assert.equal(state.commands.filter(args => args.includes('diff')).length, expectedProcesses - 2);
    assert.ok(state.peak <= 4); assert.equal(state.active, 0);
    return actual;
  };
  const clean = await assertObservation(2);
  await fs.writeFile(path.join(root, 'src/fixed.js'), 'export const value = "changed";\n');
  await fs.unlink(path.join(root, 'src/delete.js'));
  git('mv', 'src/rename-old.js', 'src/rename new.js');
  assert.match(git('status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--', ...selected), /\x002 R\./);
  for (let index = 0; index < 7; index++) await fs.writeFile(path.join(root, 'src', 'Unicode-λ ' + index + '.js'), 'new ' + index);
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; }), completionOrder = [];
  state.afterRead = async (_root, filename) => {
    if (filename.endsWith('Unicode-λ 0.js')) await firstGate;
    else releaseFirst();
    completionOrder.push(path.basename(filename));
  };
  await assertObservation(4);
  assert.deepEqual(originalDirtyInventory.find(entry => entry.path === 'src/delete.js'), { path: 'src/delete.js', missing: true });
  assert.ok(originalDirtyInventory.some(entry => entry.path === 'src/rename new.js' && entry.hash));
  for (let index = 0; index < 7; index++) {
    assert.ok(originalDirtyInventory.some(entry => entry.path === 'src/Unicode-λ ' + index + '.js' && entry.hash));
  }
  assert.notEqual(completionOrder[0], 'Unicode-λ 0.js', 'out-of-order reader completion must preserve the canonical identity fold');
  state.afterRead = null;
  git('reset', '--hard', '--quiet', 'HEAD'); git('clean', '-fd', '--quiet', '--', 'src');
  const original = await fs.readFile(path.join(root, 'src/fixed.js'));
  await fs.writeFile(path.join(root, 'src/fixed.js'), 'staged-only difference'); git('add', 'src/fixed.js');
  await fs.writeFile(path.join(root, 'src/fixed.js'), original);
  assert.equal(git('diff', '--name-only', '-z', 'HEAD', '--', ...selected), '');
  assert.deepEqual(await assertObservation(4), clean, 'staged/worktree cancellation retains the original zero-file content identity');
  git('reset', '--hard', '--quiet', 'HEAD');

  for (const change of ['tracked', 'untracked', 'head', 'malformed-status', 'malformed-diff']) {
    await fs.writeFile(path.join(root, 'src/fixed.js'), 'dirty observation start');
    let fired = false;
    state.beforeRead = async (_root, filename) => {
      if (fired || !filename.endsWith('fixed.js')) return;
      fired = true;
      if (change === 'tracked') await fs.writeFile(path.join(root, 'src/second.js'), 'changed membership');
      if (change === 'untracked') await fs.writeFile(path.join(root, 'src/new member.js'), 'new membership');
      if (change === 'head') git('commit', '--quiet', '--allow-empty', '-m', 'HEAD changed during original reader');
    };
    let statusCount = 0, diffCount = 0;
    state.afterGit = async (args, result) => {
      if (args.includes('status') && ++statusCount === 2 && change === 'malformed-status') result.stdout += '? incomplete';
      if (args.includes('diff') && ++diffCount === 2 && change === 'malformed-diff') result.stdout = result.stdout.slice(0, -1);
    };
    const observed = await observeStageProducer();
    assert.equal(fired, true); assert.equal(observed.identity, null, change + ' must invalidate reuse admission');
    assert.equal(state.active, 0, change + ' must settle all original readers');
    state.beforeRead = null; state.afterGit = null;
    git('reset', '--hard', '--quiet', 'HEAD'); git('clean', '-fd', '--quiet', '--', 'src');
  }

  // Hold the original read promises at their owner boundary. Cancellation must
  // stop queued admissions and wait for every already-admitted reader; elapsed
  // time or a detached cleanup callback is not settlement evidence.
  for (let index = 0; index < 9; index++) await fs.writeFile(path.join(root, 'src', 'queued-' + index + '.js'), 'original ' + index);
  let releaseReaders, admitReaders;
  const gate = new Promise(resolve => { releaseReaders = resolve; });
  const admitted = new Promise(resolve => { admitReaders = resolve; });
  let reads = 0, settled = false;
  state.beforeRead = async (_root, filename, options) => {
    assert.equal(options.maxBytes, 8 * 1024 * 1024);
    if (!filename.includes('queued-')) return;
    if (++reads === 4) admitReaders();
    await gate;
  };
  const controller = new AbortController(), reason = new Error('original producer cancellation');
  state.commands.length = 0; state.peak = 0;
  const cancelled = observeStageProducer(controller.signal).finally(() => { settled = true; });
  const rejected = assert.rejects(cancelled, error => {
    assert.equal(error.code, 'ABORT_ERR');
    const retained = new Set(), pending = [error];
    while (pending.length) {
      const current = pending.pop();
      if (!current || retained.has(current)) continue;
      retained.add(current); pending.push(current.cause, ...(current.errors || []));
    }
    assert.ok(retained.has(reason), 'the original cancellation reason remains in the settled cause graph');
    return true;
  });
  await admitted;
  controller.abort(reason);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(state.active, 4); assert.equal(reads, 4);
  releaseReaders(); await rejected;
  assert.equal(state.active, 0); assert.equal(reads, 4); assert.equal(state.peak, 4);
  assert.equal(state.commands.length, 2, 'cancellation must not start final Git observations');

  let outsideRead = false;
  state.beforeRead = async (_root, filename) => { if (filename.includes('outside.js')) outsideRead = true; };
  state.afterGit = async (args, result) => { if (args.includes('status')) result.stdout += '? ../outside.js\0'; };
  assert.equal((await observeStageProducer()).identity, null, 'unsafe membership must not become an admitted missing file');
  assert.equal(outsideRead, false); assert.equal(state.active, 0);
  state.afterGit = null;

  let released = false;
  const pending = Object.assign(new Error('original contained reader owner'), {
    code: 'ENOENT', cacheOwnershipPending: true, cacheOwnershipReleased: () => released
  });
  state.beforeRead = async (_root, filename) => { if (filename.endsWith('queued-0.js')) throw pending; };
  await assert.rejects(observeStageProducer(), error => {
    assert.equal(error.cacheOwnershipPending, true);
    assert.equal(error.cacheOwnershipReleased(), false);
    released = true;
    assert.equal(error.cacheOwnershipReleased(), true, 'the original owner alone supplies later settlement');
    return true;
  });
  assert.equal(state.active, 0);
} finally {
  hooks.deregister(); delete globalThis.__producerRealGit;
  assert.ok(path.relative(process.cwd(), dir).startsWith('.tmp' + path.sep), 'cleanup stays inside the original test-cache owner');
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Real Git producer identities preserve the original oracle, rename/deletion/index-only membership, HEAD and strict framing.');
