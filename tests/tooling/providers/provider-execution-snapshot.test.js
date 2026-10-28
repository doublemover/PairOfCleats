import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { observeProviderProfile } from '../../../src/index/tooling/provider-profile.js';
import { createObservedProviderInvocation, runObservedProviderInvocation } from '../../../src/index/tooling/provider-invocation.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

// UNVALIDATED: actual profile/invocation owners, inert callback, no tool launch.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['environment', 'cwd', 'command', 'arguments', 'configured', 'module', 'module-mismatch',
  'missing-environment', 'immutable', 'coalesced', 'resource-receiver', 'late-pending', 'post-check-failure'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`execution-snapshot-${selected}`);
const source = 'fixture source', hash = text => createHash('sha256').update(text).digest('hex');
const tool = path.join(dir, 'tool'), module = path.join(dir, 'module.js');
await fs.writeFile(tool, 'inert executable bytes'); await fs.writeFile(module, 'inert module bytes');
await fs.writeFile(path.join(dir, 'source.fixture'), source);
const ctx = { repoRoot: dir, toolingConfig: {}, mode: 'code' };
const inputs = { documents: [{ virtualPath: 'source.fixture', text: source }], targets: [], kinds: ['types'] };
const profile = await observeProviderProfile({ repoRoot: dir, providerId: 'fixture', adapterVersion: '1',
  apiProfile: 'fixture-v1', configuredCommand: [tool, '--stdio'], resolvedCommand: [tool, '--stdio'],
  toolFiles: [{ path: tool }, { path: module }], dependencyClosure: 'complete',
  sourceInputs: [{ path: 'source.fixture', hash: hash(source) }] });
const execution = () => ({ kind: 'command', cwd: dir, environment: { FIXTURE_SECRET: 'private original value' },
  configuredCommand: [tool, '--stdio'], resolvedCommand: [tool, '--stdio'] });
let calls = 0, ready = true, post = false, failure;
const open = fs.open;
const secondary = new Error('independent original profile recheck failure');
const result = { byChunkUid: {}, cacheOwnershipReleased() { assert.equal(this, result); return ready; } };
const create = (plan, execute = () => { calls++; return { byChunkUid: {} }; }) =>
  createObservedProviderInvocation({ ctx, inputs, profile, execution: plan, execute });
try {
  if (['environment', 'cwd'].includes(selected)) {
    const first = await create(execution()), next = execution();
    if (selected === 'environment') next.environment.FIXTURE_SECRET = 'changed private value';
    else { next.cwd = path.join(dir, 'another-workspace'); await fs.mkdir(next.cwd); }
    const second = await create(next);
    assert.notEqual(first.executionHash, second.executionHash); assert.notEqual(first.invocationHash, second.invocationHash);
    assert.equal(first.profileHash, second.profileHash, 'same observed tool does not collapse different execution inputs');
    assert.equal(JSON.stringify([first, second]).includes('private'), false, 'environment values never enter provenance');
    assert.equal(calls, 0, 'preparation launches no operation');
  } else if (['command', 'arguments', 'configured', 'missing-environment', 'module-mismatch'].includes(selected)) {
    const plan = execution();
    if (selected === 'command') plan.resolvedCommand[0] = module;
    if (selected === 'arguments') plan.resolvedCommand.push('--changed');
    if (selected === 'configured') plan.configuredCommand[0] = module;
    if (selected === 'missing-environment') delete plan.environment;
    if (selected === 'module-mismatch') { plan.kind = 'module'; plan.module = { path: module, sha256: hash('different module') }; }
    await assert.rejects(create(plan), { code: 'ERR_TOOLING_INVOCATION_IDENTITY' }); assert.equal(calls, 0);
  } else if (selected === 'module') {
    const plan = execution(); plan.kind = 'module'; plan.module = { path: module, sha256: hash('inert module bytes') };
    const cap = await create(plan, captured => { calls++; assert.deepEqual(captured.module, plan.module); return { byChunkUid: {} }; });
    assert.equal((await runObservedProviderInvocation(cap)).invocation, cap); assert.equal(calls, 1);
  } else if (selected === 'immutable') {
    const original = execution();
    const preparing = create(original, captured => {
      calls++; assert.equal(captured.environment.FIXTURE_SECRET, 'private original value');
      assert.equal(captured.resolvedCommand[1], '--stdio'); assert.ok(Object.isFrozen(captured));
      assert.ok(Object.isFrozen(captured.environment)); assert.ok(Object.isFrozen(captured.resolvedCommand));
      assert.throws(() => { captured.environment.FIXTURE_SECRET = 'replacement'; }, TypeError);
      return { byChunkUid: {} };
    });
    original.environment.FIXTURE_SECRET = 'caller replacement'; original.resolvedCommand.push('--late');
    const cap = await preparing; await runObservedProviderInvocation(cap); assert.equal(calls, 1);
  } else if (selected === 'coalesced') {
    const cap = await create(execution());
    const [first, second] = await Promise.all([runObservedProviderInvocation(cap), runObservedProviderInvocation(cap)]);
    assert.equal(first, second); assert.equal(calls, 1);
  } else {
    if (selected !== 'resource-receiver') fs.open = async (filename, ...args) => {
      if (post && filename === tool) { ready = false; if (selected === 'post-check-failure') throw secondary; }
      return open(filename, ...args);
    };
    const cap = await create(execution(), captured => {
      calls++; assert.equal(captured.cwd, dir); post = true; return result;
    });
    if (selected === 'resource-receiver') {
      const output = await runObservedProviderInvocation(cap); assert.equal(output.cacheOwnershipReleased(), true);
    } else {
      await assert.rejects(runObservedProviderInvocation(cap), error => { failure = error; return errorGraphIncludes(error, result); });
      assert.equal(failure.cacheOwnershipReleased(), false);
      if (selected === 'post-check-failure') assert.equal(errorGraphIncludes(failure, secondary), true);
      ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
    }
    assert.equal(calls, 1);
  }
} finally {
  fs.open = open; ready = true;
  const parent = path.dirname(dir); assert.ok(path.resolve(dir).startsWith(path.resolve(parent) + path.sep));
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`Provider execution snapshot: ${selected}`);
