import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLintAnalyzer } from '../../../src/index/lint-runtime.js';
import { createLintPolicy, createLintSource, isReusableLintOutcome } from '../../../src/index/lint-policy.js';
import { buildDependencySignatures } from '../../../src/index/build/indexer/signatures.js';

const gate = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const contains = (error, expected) => error === expected || Boolean(error?.cause && contains(error.cause, expected))
  || Boolean(error?.errors?.some(row => contains(row, expected)));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lint-policy-'));
const cwd = process.cwd(), rootA = path.join(temporary, 'a'), rootB = path.join(temporary, 'b');
const source = 'function f() { return 1; missing(); }\n', relative = 'same.js';
const originalSentinel = Object.getOwnPropertyDescriptor(globalThis, '__pocLintConfigLoads');
const releases = [], operations = [];
try {
  for (const root of [rootA, rootB]) {
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'eslint.config.mjs'),
      'globalThis.__pocLintConfigLoads = (globalThis.__pocLintConfigLoads || 0) + 1; throw new Error("repository config executed");\nexport default [];\n');
  }
  assert.notEqual(cwd, rootA); assert.notEqual(cwd, rootB);
  const policyA = createLintPolicy(rootA), policyB = createLintPolicy(rootB, { 'no-unreachable': 0 });
  for (const order of [[policyA, policyB], [policyB, policyA]]) {
    const analyze = createLintAnalyzer();
    for (const policy of [...order, ...order]) {
      const result = await analyze(source, relative, { root: policy.root, policy });
      assert.equal(result.receipt.status, 'completed');
      assert.equal(result.receipt.policy.identity, policy.identity);
      assert.deepEqual(result.receipt.source, createLintSource(source, relative, policy));
      assert.equal(result.messages.some(row => row.ruleId === 'no-unreachable'), policy === policyA);
      assert.equal(result.receipt.clean, policy === policyB);
      assert.equal(isReusableLintOutcome(result.receipt, policy), true);
      assert.equal(isReusableLintOutcome(result.receipt, policy === policyA ? policyB : policyA), false);
    }
  }
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, '__pocLintConfigLoads'), originalSentinel);
  assert.equal(process.cwd(), cwd, 'repository isolation never mutates process cwd');
  const inline = await createLintAnalyzer()('/* eslint-disable no-unreachable */\n' + source, relative, { root: rootA });
  assert.ok(inline.messages.some(row => row.ruleId === 'no-unreachable'), 'source directives cannot change admitted policy');
  const base = { root: rootA, lintEnabled: true, lintPolicy: policyA };
  const alternate = { ...base, lintPolicy: createLintPolicy(rootA, { 'no-unreachable': 0 }) };
  const before = buildDependencySignatures(base, 'code', 'same-tokens');
  const after = buildDependencySignatures(alternate, 'code', 'same-tokens');
  assert.notEqual(before.enrichment, after.enrichment);
  for (const key of ['parse', 'lexical', 'embeddings', 'artifacts']) assert.equal(before[key], after[key]);
  assert.deepEqual(buildDependencySignatures(base, 'code', 'same-tokens'), before);

  const state = { initialized: 0, calls: 0, ignored: false, result: [{ messages: [] }], failInit: null, failLint: null, wait: null };
  class ControlledEslint {
    constructor(options) {
      state.initialized++;
      assert.equal(options.overrideConfigFile, true); assert.equal(options.allowInlineConfig, false);
      assert.equal(options.cache, false); assert.equal(options.fix, false); assert.equal(options.ignore, false);
      assert.deepEqual(options.flags, []); assert.ok(path.isAbsolute(options.cwd));
      assert.equal(Object.hasOwn(options, 'useEslintrc'), false);
      if (state.failInit) throw state.failInit;
    }
    async isPathIgnored() { return state.ignored; }
    async lintText() {
      state.calls++; const wait = state.wait;
      if (wait) { wait.entered.resolve(); await wait.release.promise; }
      if (state.failLint) throw state.failLint;
      return state.result;
    }
  }
  const analyze = createLintAnalyzer({ Eslint: ControlledEslint, maxSessions: 1 });
  const run = (extra = {}, text = source, rel = relative) => analyze(text, rel, { root: rootA, ...extra });
  const initialization = Object.freeze(new Error('constructor unavailable'));
  state.failInit = initialization;
  const unavailable = await run();
  assert.equal(unavailable.receipt.status, 'unavailable'); assert.equal(unavailable.error, initialization);
  assert.equal(unavailable.receipt.clean, false); assert.equal(isReusableLintOutcome(unavailable.receipt, policyA), false);
  state.failInit = null;
  assert.equal((await run()).receipt.clean, true, 'a constructor failure cannot poison future recovery');
  const execution = Object.freeze(Object.assign(new Error('lintText failed'), { code: 'LINT_FAILED' }));
  state.failLint = execution;
  const failed = await run();
  assert.equal(failed.receipt.status, 'failed'); assert.equal(failed.error, execution);
  assert.equal(failed.receipt.failure.code, 'LINT_FAILED'); assert.equal(isReusableLintOutcome(failed.receipt, policyA), false);
  state.failLint = null;
  const recovered = await run(); assert.equal(recovered.receipt.clean, true);
  assert.equal(state.initialized, 3, 'failed runtimes are re-created rather than cached as clean');
  let messageReads = 0;
  const unreadable = Object.freeze(Object.defineProperty({ code: 'LINT_UNREADABLE' }, 'message', {
    get() { messageReads++; throw new Error('diagnostic getter must not run'); }
  }));
  state.failLint = unreadable;
  const diagnostic = await run();
  assert.equal(diagnostic.error, unreadable); assert.equal(diagnostic.receipt.failure.inspectionUnavailable, true);
  assert.equal(diagnostic.receipt.status, 'failed'); assert.equal(messageReads, 0);
  state.failLint = null; await run();
  const initialized = state.initialized;
  assert.equal((await run({ enabled: false })).receipt.status, 'disabled');
  assert.equal((await run({}, source, 'same.ts')).receipt.status, 'unsupported');
  assert.equal(state.initialized, initialized);
  state.ignored = true;
  assert.equal((await run()).receipt.status, 'ignored'); state.ignored = false;
  state.result = [];
  const missing = await run(); assert.equal(missing.receipt.status, 'ignored');
  assert.equal(isReusableLintOutcome(missing.receipt, policyA), false, 'unqualified empty results cannot replay');
  state.result = [{ messages: [{ fatal: true, severity: 2, message: 'parser rejected source', line: 1, column: 1 }] }];
  const unsupported = await run(); assert.equal(unsupported.receipt.status, 'unsupported'); assert.equal(unsupported.receipt.clean, false);
  state.result = [{ messages: Array.from({ length: 300 }, () => ({ severity: 1, message: 'x'.repeat(2048), line: 1 })) }];
  const capped = await run(); assert.equal(capped.receipt.diagnostics.total, 300);
  assert.equal(capped.receipt.diagnostics.truncated, true); assert.ok(capped.messages.length <= 256);
  assert.ok(Buffer.byteLength(JSON.stringify(capped.messages)) <= 65536);
  assert.equal(isReusableLintOutcome(capped.receipt, policyA), false);
  const controller = new AbortController(); controller.abort('fixture-cancel');
  const calls = state.calls;
  await assert.rejects(run({ signal: controller.signal }), error => error.code === 'ABORT_ERR' && error.lintOutcome.status === 'canceled');
  assert.equal(state.calls, calls, 'pre-abort does not begin lint work');
  state.result = [{ messages: [] }];
  const waiting = { entered: gate(), release: gate() }; state.wait = waiting; releases.push(waiting.release.resolve);
  const active = new AbortController(); let settled = false;
  const operation = run({ signal: active.signal }); operations.push(operation);
  operation.then(() => { settled = true; }, () => { settled = true; });
  await waiting.entered.promise; active.abort(); await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false, 'cancellation retains actual outstanding lint ownership');
  const saturated = await analyze(source, relative, { root: rootB });
  assert.equal(saturated.receipt.reason, 'runtime-capacity');
  state.failLint = execution; waiting.release.resolve();
  await assert.rejects(operation, error => error.code === 'ABORT_ERR' && error.lintOutcome.status === 'canceled' && contains(error, execution));
  state.wait = null; state.failLint = null;
  assert.equal((await analyze(source, relative, { root: rootB })).receipt.clean, true);
  assert.equal((await run()).receipt.clean, true, 'idle root eviction permits bounded recovery');
  assert.equal((await run({ root: null })).receipt.status, 'unavailable');
  assert.equal((await run({}, source, '../escape.js')).receipt.status, 'unavailable');
  assert.throws(() => createLintPolicy(rootA, { 'custom-plugin/rule': 2 }), /Unsupported/);
  assert.equal(isReusableLintOutcome({}, policyA), false);
  console.log('isolated root-qualified lint policy, outcomes, replay identity and bounded ownership passed');
} finally {
  releases.forEach(release => release()); await Promise.allSettled(operations);
  if (originalSentinel) Object.defineProperty(globalThis, '__pocLintConfigLoads', originalSentinel);
  else delete globalThis.__pocLintConfigLoads;
  await fs.rm(temporary, { recursive: true, force: true });
}
