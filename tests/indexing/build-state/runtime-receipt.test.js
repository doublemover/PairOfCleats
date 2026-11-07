#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initBuildState, flushBuildState } from '../../../src/index/build/build-state.js';
import { persistRuntimeAttempt } from '../../../src/index/build/build-state/runtime.js';
import { createRuntimeAttempt, observeRuntimePath, sanitizeRuntimeReceipt, mergeRuntimeAttempts } from '../../../src/shared/runtime-envelope/receipt.js';
import { readRuntimeReceipt, redactRuntimePaths } from '../../../src/shared/runtime-envelope/read-receipt.js';
import { validateBuildState } from '../../../src/contracts/validators/build-state.js';
import { setProgressHandlers } from '../../../src/shared/progress-runtime.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-runtime-receipt-'));
const buildRoot = path.join(dir, 'build');
const init = () => initBuildState({ buildRoot, buildId: 'generation', repoRoot: dir, modes: ['code'], stage: 'stage2' });
try {
  await init();
  const attempt = await createRuntimeAttempt({ buildId: 'generation', stage: 'stage2', paths: { repo: dir, build: buildRoot, models: path.join(dir, 'missing') }, envelope: { runtime: { nodeOptions: { requested: { value: '--require https://alice:secret-canary@example.test/ --trace-warnings' }, planned: { value: '--unrecognized secret-canary' } } }, process: { argv: ['secret-canary'] } }, inputs: { nested: { password: 'secret-canary' }, rawArgv: ['secret-canary'], url: 'https://alice:secret-canary@example.test/?token=secret-canary' } });
  await persistRuntimeAttempt(buildRoot, attempt, { lifecycle: 'running' });
  const statePath = path.join(buildRoot, 'build_state.json');
  let state = JSON.parse(await fs.readFile(statePath));
  assert.equal(validateBuildState(state).ok, true, JSON.stringify(validateBuildState(state)));
  assert.equal(JSON.stringify(state).includes('secret-canary'), false);
  assert.equal(state.runtime.attempts[0].paths.models.state, 'missing');
  const before = await fs.stat(statePath);
  let report = await readRuntimeReceipt({ buildRoot, now: Date.now() + 120000 });
  assert.equal(report.attempts[0].freshness, 'stale-or-unknown');
  assert.equal((await fs.stat(statePath)).mtimeMs, before.mtimeMs);
  await init();
  assert.equal(JSON.parse(await fs.readFile(statePath)).runtime.attempts.length, 1, 'initialization must preserve prior attempts');
  const resumed = await createRuntimeAttempt({ buildId: 'generation', stage: 'stage2', parentAttemptId: attempt.attemptId });
  await persistRuntimeAttempt(buildRoot, resumed);
  assert.notEqual(resumed.attemptId, attempt.attemptId);
  await persistRuntimeAttempt(buildRoot, resumed, { lifecycle: 'succeeded' });
  report = await readRuntimeReceipt({ buildRoot, attemptId: resumed.attemptId });
  assert.equal(report.attempts[0].freshness, 'terminal');
  assert.equal(report.attempts[0].parentAttemptId, attempt.attemptId);
  for (const code of ['EACCES', 'ENOSPC', 'ERR_BUILD_STATE_PATCH_TIMEOUT']) {
    await assert.rejects(persistRuntimeAttempt(buildRoot, attempt, { lifecycle: 'succeeded' }, { write: async () => { throw Object.assign(new Error(code), { code }); } }), { code: 'ERR_RUNTIME_RECEIPT_PERSIST' });
    assert.equal(attempt.persistence.status, 'degraded');
    assert.equal(attempt.lifecycle, 'running');
  }
  const oldRename = fs.rename;
  let injectedRenames = 0;
  const writeDiagnostics = [];
  const restoreProgress = setProgressHandlers({ logLine: (message, meta) => writeDiagnostics.push({ message, meta }) });
  fs.rename = async (from, to) => {
    if (to === statePath && String(from).startsWith(`${statePath}.tmp-`)) {
      injectedRenames += 1;
      throw Object.assign(new Error('receipt disk full'), { code: 'ENOSPC' });
    }
    return oldRename(from, to);
  };
  try {
    await assert.rejects(persistRuntimeAttempt(buildRoot, attempt, { lifecycle: 'succeeded' }), { code: 'ERR_RUNTIME_RECEIPT_PERSIST' });
  } finally { fs.rename = oldRename; restoreProgress(); }
  assert.ok(injectedRenames > 0, 'the real atomic publication must hit the injected disk failure');
  assert.deepEqual(writeDiagnostics, [{
    message: `[build_state] [build_state] state write failed (ERR_ATOMIC_WRITE) for ${buildRoot}.`,
    meta: { kind: 'warning' }
  }], 'assert the expected failed-publication diagnostic and reject any extra diagnostic');
  state = JSON.parse(await fs.readFile(statePath));
  assert.equal(state.runtime.attempts.find((item) => item.attemptId === attempt.attemptId).lifecycle, 'running');
  const history = mergeRuntimeAttempts(null, { attempts: Array.from({ length: 24 }, (_, i) => ({ ...resumed, attemptId: `attempt-${i}`, startedAt: String(i).padStart(4, '0') })) });
  assert.equal(history.attempts.length, 16);
  assert.equal(history.prunedAttemptCount, 8);
  const alias = redactRuntimePaths({ first: dir, nested: { root: dir } });
  assert.equal(alias.first, alias.nested.root);
  const windows = await observeRuntimePath('C:\\Users\\test\\AppData\\Local\\PairOfCleats', { platform: 'linux' });
  assert.equal(windows.state, 'unknown');
  assert.equal(windows.canonical, null);
  const blocked = await observeRuntimePath(dir, { io: { stat: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } } });
  assert.equal(blocked.state, 'inaccessible');
  const notDirectory = await observeRuntimePath(dir, { io: { stat: async () => { throw Object.assign(new Error('bad path'), { code: 'ENOTDIR' }); } } });
  assert.equal(notDirectory.state, 'unknown');
  // Exercise the path observer's existing-ancestor projection with a controlled
  // filesystem boundary. This unit case creates no privileged links and makes
  // no claim about physical OS redirection support.
  const redirect = path.join(dir, 'redirect');
  const missing = () => Object.assign(new Error('missing fixture path'), { code: 'ENOENT' });
  const redirected = await observeRuntimePath(path.join(redirect, 'missing'), { io: {
    stat: async () => { throw missing(); },
    realpath: async selected => { if (selected === redirect) return fs.realpath(dir); throw missing(); }
  } });
  assert.equal(redirected.state, 'missing');
  // Resolve the real temp ancestor too, since Windows can use a short-name alias.
  assert.equal(redirected.canonical, path.join(await fs.realpath(dir), 'missing'));
  assert.equal(redirected.selected, path.join(dir, 'redirect', 'missing'));
  assert.equal(redirected.absolute, path.resolve(dir, 'redirect', 'missing'));
  assert.equal(redirected.canonicalMethod, 'existing-ancestor');
  assert.notEqual(redirected.absolute, redirected.canonical);
  const legacy = path.join(dir, 'legacy');
  await fs.mkdir(legacy);
  await fs.writeFile(path.join(legacy, 'build_state.json'), JSON.stringify({ buildId: 'old', tool: { version: 'old' } }));
  assert.equal((await readRuntimeReceipt({ buildRoot: legacy })).evidence, 'legacy-artifact-inference');
  await fs.writeFile(path.join(legacy, 'build_state.json'), '{');
  assert.equal((await readRuntimeReceipt({ buildRoot: legacy })).errorCode, 'ERR_RUNTIME_RECEIPT_JSON');
  assert.equal(sanitizeRuntimeReceipt({ accessToken: 'secret' }).accessToken.redacted, true);
  await flushBuildState(buildRoot);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('runtime receipt durability and read-only projection test passed');
