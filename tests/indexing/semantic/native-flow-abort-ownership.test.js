import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { abortSemanticPartitionOnFailure } from '../../../src/index/build/artifacts/writers/semantic/partition.js';

const collectUrl = new URL('../../../src/index/semantic/collect-file.js', import.meta.url).href;
const syntaxUrl = new URL('../../../src/index/semantic/native-syntax.js', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === collectUrl + '?abort-owner' && specifier === './native-syntax.js') return { url: 'native-flow:syntax-fault', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'native-flow:syntax-fault') return { format: 'module', shortCircuit: true, source: `
      export * from ${JSON.stringify(syntaxUrl)};
      export const prepareNativeSemanticSyntax=()=>({tree:{},identity:{family:'fixture',version:'1',options:{}},
        close(){const state=globalThis.nativeFlowAbortProbe;state.closes++;state.beforeClose?.();throw state.closeFailure;}});
      export const createNativeSemanticCollector=()=>({summary:{},structuralSlots:[],owners:[],anchors:new Map(),
        batches:(function*(){throw globalThis.nativeFlowAbortProbe.primary;})()});` };
    return next(url, context);
  }
});
const contains = (error, expected) => {
  const queue = [error], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); if (Object.is(value, expected)) return true;
    if (value === null || !['object', 'function'].includes(typeof value) || seen.has(value)) continue;
    seen.add(value); if (Object.hasOwn(value, 'cause')) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
  return false;
};
const reject = async action => {
  let failed = false, failure;
  try { await action(); } catch (error) { failed = true; failure = error; }
  assert.equal(failed, true); return failure;
};
const fixture = await createRecoveryFixture('x=1\n');
try {
  const { collectFileSemanticFacts } = await import(collectUrl + '?abort-owner');
  const policy = normalizeSemanticConfig({ enabled: true, languages: ['python'], enrichment: { localFlow: 'eager' } });
  for (const primary of [null, undefined, false, 0, '', Object.freeze(new Error('frozen syntax/flow failure'))]) {
    const closeFailure = Object.freeze(new Error('original native tree close'));
    const probe = globalThis.nativeFlowAbortProbe = { primary, closeFailure, closes: 0 };
    const failure = await reject(() => collectFileSemanticFacts({ ...fixture.options, bytes: fixture.bytes,
      text: 'x=1\n', language: 'python', relPath: 'original.js', repositoryNamespace: fixture.root, policy }));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, closeFailure), true);
    assert.equal(probe.closes, 1); assert.equal(fixture.account.used, 0); assert.deepEqual(await fixture.partDirectories(), []);
    const cleanup = Object.freeze(new Error('independent staging abort'));
    const abortFailure = await reject(() => abortSemanticPartitionOnFailure({ async abort() { throw cleanup; } }, primary));
    assert.equal(contains(abortFailure, primary), true); assert.equal(contains(abortFailure, cleanup), true);
  }
  let settled = false;
  const pending = Object.assign(new Error('original independent semantic work'), { cacheOwnershipPending: false,
    cacheOwnershipReleased() { return settled; } });
  const probe = globalThis.nativeFlowAbortProbe = { primary: pending, closeFailure: false, closes: 0,
    beforeClose() { pending.cacheOwnershipReleased = () => true; } };
  const failure = await reject(() => collectFileSemanticFacts({ ...fixture.options, bytes: fixture.bytes,
    text: 'x=1\n', language: 'python', relPath: 'original.js', repositoryNamespace: fixture.root, policy }));
  assert.equal(contains(failure, pending), true); assert.equal(contains(failure, false), true);
  assert.equal(failure.cacheOwnershipReleased(), false, 'tree cleanup cannot replace original settlement authority');
  settled = true; assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(probe.closes, 1);
} finally { delete globalThis.nativeFlowAbortProbe; hooks.deregister(); await fixture.cleanup(); }
console.log('Semantic abort and native tree closure retain falsey/frozen primaries, independent cleanup and original settlement observations.');
