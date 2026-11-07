import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { inspectNativeOnnxParity, assertNativeOnnxParity, createNativeOnnxIdentityModel } from '../../../src/shared/native-onnx-probe.js';
import { applyTestEnv } from '../../helpers/test-env.js';

await requireBootstrap(); applyTestEnv();
const require = createRequire(import.meta.url), before = new Set(Object.keys(require.cache));
const parity = inspectNativeOnnxParity(process.cwd());
assert.equal(parity.selectedVersion, parity.transformers.requiredVersion); assert.equal(parity.root.version, parity.selectedVersion);
assert.equal(createNativeOnnxIdentityModel().length, 83);
for (const change of [value => { value.transformers.requiredVersion = '0.0.0'; }, value => { value.root.version = '0.0.0'; },
  value => { value.huggingface.version = '0.0.0'; }, value => { value.huggingface.packageRoot += '-different'; },
  value => { value.huggingface.entry += '-different'; }, value => { value.huggingface.addon += '-different'; },
  value => { value.huggingface.commonRoot += '-different'; }, value => { value.huggingface.commonEntry += '-different'; },
  value => { value.huggingface.commonVersion = '0.0.0'; }, value => { value.transformers.commonEntry += '-different'; }]) {
  const changed = structuredClone(parity); change(changed); assert.throws(() => assertNativeOnnxParity(changed), { code: 'ERR_NATIVE_ONNX_PARITY' });
}
assert.deepEqual(new Set(Object.keys(require.cache)), before, 'Positive/negative metadata admission cannot load native addons.');
console.log('Actual installed ONNX metadata parity and discriminating split-universe negatives passed without native import.');
