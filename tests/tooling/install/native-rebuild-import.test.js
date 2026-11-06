import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/native-rebuild-import/')[1];
assert.ok(['inert-and-help', 'strict-admission-and-cancellation', 'captured-mode-and-context'].includes(mode));
const owner = new URL('../../../tools/setup/rebuild-native.js', import.meta.url).href;
const guarded = new Map([
  ['./preflight.js', ['runSetupPreflight']], ['./windows-capability.js', ['verifyWindowsCompilerCapability']],
  ['./apply-patches.js', ['applyPatchesAsync']], ['../../src/shared/native-package-probe.js', ['probeNodeRealmLifecycle']],
  ['../../src/shared/bootstrap-readiness.js', ['captureBootstrapVerification', 'recordBootstrapReadiness']],
  ['../../src/shared/subprocess/command-invocation.js', ['spawnResolvedSubprocess']],
  ['./bootstrap-tasks.js', ['resolveBootstrapBudget', 'runBootstrapTasks']]
]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (mode === 'captured-mode-and-context' && context.parentURL?.split('?')[0] === owner && specifier === './checkout-mutation.js') return {
      url: 'native-original-session-fixture:owner', shortCircuit: true
    };
    if (context.parentURL?.split('?')[0] === owner && guarded.has(specifier)) return { url: 'native-inert:' + encodeURIComponent(specifier), shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'native-original-session-fixture:owner') return { format: 'module', source: `
      export const withCheckoutMutation = async (root, operation, options) => {
        const fixture=globalThis.nativeAdmissionFixture; fixture.options=options; fixture.root=root;
        fixture.entered.resolve(); await fixture.release.promise; return operation(fixture.session);
      };
      export const requireCheckoutMutationSession = (root, session) => {
        if(session!==globalThis.nativeAdmissionFixture.session) throw new Error('Lost original session');
      };`, shortCircuit: true };
    if (!url.startsWith('native-inert:')) return next(url, context);
    const specifier = decodeURIComponent(url.slice('native-inert:'.length));
    const target = JSON.stringify(new URL(specifier, owner).href);
    return { format: 'module', source: `export * from ${target};\n` + guarded.get(specifier).map(name =>
      `export const ${name} = () => {throw new Error('Unexpected native work before admission: ${name}');};`).join('\n'), shortCircuit: true };
  }
});
const previousExit = process.exit;
process.exit = () => { throw new Error('Imported native owner must never exit the host'); };
try {
  const { runNativeRebuild } = await import(owner + '?inert-import=' + mode);
  assert.equal(typeof runNativeRebuild, 'function');
  if (mode === 'inert-and-help') {
    const result = await runNativeRebuild(['--help'], { root: 'must-not-be-inspected-for-help' });
    assert.equal(result.exitCode, 0); assert.match(result.help, /--verify/); assert.match(result.help, /--repair/);
  } else if (mode === 'strict-admission-and-cancellation') {
    for (const args of [['--unknown'], ['--verify', '--repair'], ['--help', '--unknown']]) {
      await assert.rejects(runNativeRebuild(args), { code: 'ERR_CHECKOUT_BOOTSTRAP_ARGUMENTS' });
    }
    const controller = new AbortController(); controller.abort();
    await assert.rejects(runNativeRebuild([], { signal: controller.signal }), { name: 'AbortError' });
  } else {
    const fixture = { entered: Promise.withResolvers(), release: Promise.withResolvers(), session: Object.freeze({ original: true }) };
    globalThis.nativeAdmissionFixture = fixture;
    const controller = new AbortController(), parent = Object.freeze({ parent: true });
    const args = ['--verify'], options = { root: 'original-declared-root', signal: controller.signal, session: parent };
    const pending = runNativeRebuild(args, options);
    await fixture.entered.promise;
    args.splice(0); const unrelated = new AbortController(); unrelated.abort(new Error('changed invocation context'));
    options.signal = unrelated.signal; options.session = {}; options.root = 'changed-root';
    fixture.release.resolve();
    await assert.rejects(pending, /Unexpected native work before admission: resolveBootstrapBudget/,
      'the original verify mode still skips mutating preflight despite changed caller containers');
    assert.equal(fixture.options.signal, controller.signal); assert.equal(fixture.options.session, parent);
    assert.equal(fixture.root, 'original-declared-root');
  }
} finally { process.exit = previousExit; hooks.deregister(); delete globalThis.nativeAdmissionFixture; }
console.log('Native rebuild imports are inert and use the same strictly admitted operation without exiting its caller');
