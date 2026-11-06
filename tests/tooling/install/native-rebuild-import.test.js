import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/native-rebuild-import/')[1];
assert.ok(['inert-and-help', 'strict-admission-and-cancellation'].includes(mode));
const owner = new URL('../../../tools/setup/rebuild-native.js', import.meta.url).href;
const guarded = new Map([
  ['./preflight.js', ['runSetupPreflight']], ['./windows-capability.js', ['verifyWindowsCompilerCapability']],
  ['./apply-patches.js', ['applyPatchesAsync']], ['../../src/shared/native-package-probe.js', ['probeNodeRealmLifecycle']],
  ['../../src/shared/bootstrap-readiness.js', ['captureBootstrapVerification', 'recordBootstrapReadiness']],
  ['../../src/shared/subprocess/command-invocation.js', ['spawnResolvedSubprocess']]
]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.split('?')[0] === owner && guarded.has(specifier)) return { url: 'native-inert:' + encodeURIComponent(specifier), shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
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
  } else {
    for (const args of [['--unknown'], ['--verify', '--repair'], ['--help', '--unknown']]) {
      await assert.rejects(runNativeRebuild(args), { code: 'ERR_CHECKOUT_BOOTSTRAP_ARGUMENTS' });
    }
    const controller = new AbortController(); controller.abort();
    await assert.rejects(runNativeRebuild([], { signal: controller.signal }), { name: 'AbortError' });
  }
} finally { process.exit = previousExit; hooks.deregister(); }
console.log('Native rebuild imports are inert and use the same strictly admitted operation without exiting its caller');
