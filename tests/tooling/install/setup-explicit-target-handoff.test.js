import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { Writable } from 'node:stream';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { initGitRepo } from '../../helpers/git-fixture.js';
import { getIndexDir, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';

const { dir } = await prepareIsolatedTestCacheDir('setup-explicit-target-handoff');
const enclosing = path.join(dir, 'enclosing'); await fs.mkdir(enclosing); initGitRepo(enclosing);
const targets = [path.join(dir, 'plain folder'), enclosing, path.join(enclosing, 'packages/own config'), path.join(enclosing, 'packages/no config'), path.join(dir, 'no output')];
for (const target of targets) await fs.mkdir(target, { recursive: true });
for (const target of targets.slice(0, 3)) await fs.writeFile(path.join(target, '.pairofcleats.json'), '{}');
applyTestEnv({ cacheRoot: path.join(dir, 'custom cache'), extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null,
  PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify(targets) } });
let state;
globalThis.__setupTargetChild = async (_command, args, options) => {
  state.calls.push(args);
  assert.equal(args[args.indexOf('--repo') + 1], state.target);
  assert.equal(options.cwd, state.target);
  const build = args[0].endsWith('build_index.js');
  if (state.branch === 'no-output') return { ok: true, status: 0, stdout: '', stderr: '' };
  if (state.branch === 'recovery' && build && ++state.builds === 1) return { ok: false, status: 1 };
  const index = getIndexDir(state.target, 'code', loadUserConfig(state.target)); await fs.mkdir(index, { recursive: true });
  await fs.writeFile(path.join(index, 'chunk_meta.json'), '[]');
  return { ok: true, status: 0, stdout: '', stderr: '' };
};
const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/tools/setup/owned-command.js')) return { format: 'module', shortCircuit: true,
    source: 'export const runSetupCommand=(...args)=>globalThis.__setupTargetChild(...args);' };
  return next(url, context);
} });
const argv = process.argv, originalLog = console.log, originalError = console.error, originalWarn = console.warn, exit = process.exitCode;
const stdoutDescriptor = Object.getOwnPropertyDescriptor(process, 'stdout');
let output = [];
console.log = value => output.push(String(value)); console.error = console.warn = () => {};
try {
  for (const [index, target] of targets.entries()) for (const alias of ['--repo', '--root']) {
    const branch = index === 0 ? 'initial' : index === 1 ? 'stage4' : index === 2 ? 'restore' : index === 3 ? 'recovery' : 'no-output';
    state = { target: toRealPathSync(target), branch, calls: [], builds: 0 }; output = [];
    Object.defineProperty(process, 'stdout', { configurable: true, value: new Writable({
      write(chunk, _encoding, callback) { output.push(String(chunk)); callback(); }
    }) });
    const indexDir = getIndexDir(target, 'code', loadUserConfig(target)); await fs.rm(indexDir, { recursive: true, force: true });
    if (branch === 'stage4') { await fs.mkdir(indexDir, { recursive: true }); await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]'); }
    if (branch === 'restore') { await fs.mkdir(path.join(target, 'ci-artifacts'), { recursive: true }); await fs.writeFile(path.join(target, 'ci-artifacts/manifest.json'), '{}'); }
    process.argv = [argv[0], 'setup.js', alias, target, '--non-interactive', '--json', '--skip-install', '--skip-dicts',
      '--skip-models', '--skip-extensions', '--skip-tooling', '--with-sqlite', ...(branch === 'restore' ? [] : ['--skip-artifacts']),
      ...(branch === 'stage4' ? ['--skip-index'] : [])];
    await import(new URL(`../../../tools/setup/setup.js?target=${index}-${alias}`, import.meta.url));
    const summary = JSON.parse(output.at(-1)); assert.equal(summary.root, state.target);
    assert.equal(summary.steps.index.ready, branch !== 'no-output', 'exit zero alone cannot qualify target readiness');
    assert.equal(state.calls.filter(args => args[0].endsWith('build_index.js')).length, ['recovery', 'no-output'].includes(branch) ? 2 : 1);
    if (branch === 'initial') assert.equal(state.calls.some(args => args.includes('--stage')), false);
    if (branch === 'restore') assert.ok(state.calls.some(args => args[0].endsWith('restore-artifacts.js')));
    if (index >= 2) assert.notEqual(state.target, enclosing, 'nested explicit targets retain their own authority');
    process.exitCode = exit;
  }
} finally {
  process.argv = argv; console.log = originalLog; console.error = originalError; console.warn = originalWarn;
  Object.defineProperty(process, 'stdout', stdoutDescriptor);
  process.exitCode = exit; hook.deregister(); delete globalThis.__setupTargetChild;
}
console.log('Actual setup admission retains explicit plain/Git/nested/spaced targets through initial/recovery/restore/Stage4 children.');
