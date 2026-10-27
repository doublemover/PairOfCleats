#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { resolveTantivyPaths, TANTIVY_SCHEMA_VERSION } from '../../../src/shared/tantivy.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('tantivy-selected-source');
const repo = path.join(dir, 'repo'), selected = path.join(dir, 'selected-generation');
await fs.mkdir(repo, { recursive: true });
const source = path.join(selected, 'index-code');
const config = { enabled: true, autoBuild: true };
const paths = resolveTantivyPaths(source, 'code', config);
const valid = { schemaVersion: TANTIVY_SCHEMA_VERSION, mode: 'code',
  chunkCount: 1, docCount: 1, vocabCount: 1 };
const save = async metadata => {
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.writeFile(paths.metaPath, JSON.stringify(metadata));
};
const calls = [];
let behavior = 'publish', childSettled = false, abort = null;
globalThis.__tantivySelectedSource = async (run, command, args, options) => {
  calls.push({ command, args, signal: options.signal });
  assert.equal(args[args.indexOf('--index-root') + 1], selected,
    'auto-build must retain the request-selected generation instead of reselecting latest');
  if (behavior === 'publish') { await save(valid); return { exitCode: 0 }; }
  if (behavior === 'nonzero') return { exitCode: 1 };
  // Explicit bounded fixture command exercises real owned-child cancellation.
  // The native adapter below is a protocol fixture, not installed Tantivy evidence.
  try {
    return await run(command, ['-e', 'console.log("ready");setTimeout(()=>{},500)'], {
      ...options, stdio: ['ignore', 'pipe', 'pipe'], onStdout: () => abort.abort()
    });
  } finally { childSettled = true; }
};
const runner = new URL('../../../src/shared/subprocess/runner.js', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/cli/load-indexes/backend.js')) {
      if (specifier.endsWith('/optional-deps.js')) return { url: 'tantivy-source:optional', shortCircuit: true };
      if (specifier.endsWith('/subprocess/runner.js')) return { url: 'tantivy-source:runner', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'tantivy-source:optional') return { format: 'module', shortCircuit: true, source: `
      export const tryRequire = () => ({ok:true,mod:{openIndex(){throw new Error('native open is outside this fixture');},search(){return [];}}});` };
    if (url === 'tantivy-source:runner') return { format: 'module', shortCircuit: true, source: `
      import {spawnSubprocess as run} from ${JSON.stringify(runner)};
      export const spawnSubprocess = (...args) => globalThis.__tantivySelectedSource(run,...args);
      export const spawnSubprocessSync = () => {throw new Error('auto-build must leave the request event loop responsive');};` };
    return next(url, context);
  }
});
try {
  const { createIndexBackendLoader } = await import('../../../src/retrieval/cli/load-indexes/backend.js');
  const loader = (overrides = {}) => createIndexBackendLoader({ rootDir: repo,
    userConfig: { cache: { root: path.join(dir, 'cache') } }, backendLabel: 'tantivy',
    backendForcedTantivy: true, tantivyConfig: config, ...overrides });
  const passive = loader({ tantivyConfig: { ...config, autoBuild: false } });
  for (const change of [{ schemaVersion: TANTIVY_SCHEMA_VERSION + 1 }, { mode: 'prose' },
    { chunkCount: -1 }, { docCount: .5 }, { vocabCount: null }]) {
    await save({ ...valid, ...change });
    const state = await passive.attachTantivy({}, 'code', source);
    assert.equal(state.available, false);
    assert.equal(state.reason, 'missing-or-incompatible-metadata');
  }
  assert.equal(calls.length, 0, 'passive admission never starts an implicit build');
  await save(valid);
  assert.equal((await passive.attachTantivy({}, 'code', source)).available, true,
    'valid legacy metadata remains the existing coarse readiness control, not full native qualification');
  await save({ ...valid, mode: 'prose' });
  const rebuilt = await loader().attachTantivy({}, 'code', source);
  assert.equal(rebuilt.available, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('--index-root'));
  assert.equal(calls[0].args[calls[0].args.indexOf('--repo') + 1], repo);
  await assert.rejects(loader().attachTantivy({}, 'code', path.join(dir, 'unexpected-layout')),
    { code: 'ERR_TANTIVY_SOURCE_LAYOUT' });
  assert.equal(calls.length, 1);
  behavior = 'nonzero'; await save({ ...valid, mode: 'prose' });
  await assert.rejects(loader().attachTantivy({}, 'code', source), /build failed/);
  assert.equal((await passive.attachTantivy({}, 'code', source)).available, false,
    'failed auto-build cannot turn rejected metadata into availability');
  behavior = 'abort'; abort = new AbortController();
  let responsive = false;
  const timer = setTimeout(() => { responsive = !childSettled; }, 10);
  try {
    await assert.rejects(loader({ signal: abort.signal }).attachTantivy({}, 'code', source),
      error => ['ABORT_ERR', 'SUBPROCESS_ABORT'].includes(error.code));
  } finally { clearTimeout(timer); }
  assert.equal(responsive, true);
  assert.equal(childSettled, true);
  assert.equal(calls.at(-1).signal, abort.signal);
} finally { hooks.deregister(); delete globalThis.__tantivySelectedSource; }
console.log('Tantivy auto-build retains selected source, value admission and owned async cancellation; native publication remains separate.');
