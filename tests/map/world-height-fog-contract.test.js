import assert from 'node:assert/strict';
import { ShaderLib, Matrix4, Vector3 } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { injectWorldFogPosition } from '../../src/map/isometric/client/world-fog.js';

for (const name of ['physical', 'basic', 'dashed']) {
  const shader = { vertexShader: ShaderLib[name].vertexShader };
  injectWorldFogPosition(shader);
  assert.match(shader.vertexShader, /vec4 isoFogWorld = vec4\(transformed, 1\.0\)/);
  assert.ok(shader.vertexShader.indexOf('batchingMatrix * isoFogWorld') < shader.vertexShader.indexOf('instanceMatrix * isoFogWorld'));
  assert.ok(shader.vertexShader.indexOf('instanceMatrix * isoFogWorld') < shader.vertexShader.indexOf('modelMatrix * isoFogWorld'));
  assert.doesNotMatch(shader.vertexShader, /modelMatrix \* vec4\(position, 1\.0\)/);
}
const line = new LineMaterial();
const wideShader = { vertexShader: line.vertexShader };
injectWorldFogPosition(wideShader, { wideLine: true });
assert.match(wideShader.vertexShader, /isoFogView = worldPos.xyz/);
assert.match(wideShader.vertexShader, /isoFogView = mvPosition.xyz/);
assert.match(wideShader.vertexShader, /\+ cameraPosition/);
assert.doesNotMatch(wideShader.vertexShader, /isoFogWorld = vec4\(transformed/);
assert.throws(() => injectWorldFogPosition({ vertexShader: 'void main() {}' }), /supported world-position/);
const parent = new Matrix4().makeTranslation(0, 4, 0);
for (const height of [5, 20]) {
  const instance = new Matrix4().makeTranslation(0, height, 0);
  const actual = new Vector3(0, 0.5, 0).applyMatrix4(instance).applyMatrix4(parent);
  assert.equal(actual.y, height + 4.5);
}
line.dispose();
console.log('Mesh and wide-line fog use their actual transform representations; GPU pixel parity remains separate.');
