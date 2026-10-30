import assert from 'node:assert/strict';
import { createEnvironmentOwner } from '../../src/map/isometric/client/environment-owner.js';

const scene = { environment: null }, targets = [], inputs = [];
let generatorDisposals = 0, fail = false;
const THREE = {
  EquirectangularReflectionMapping: 303,
  PMREMGenerator: class {
    fromEquirectangular(input) {
      assert.equal(input.mapping, 303);
      if (fail) throw new Error('conversion failed');
      const target = { texture: {}, disposals: 0, dispose() { this.disposals++; } };
      targets.push(target);
      return target;
    }
    dispose() { generatorDisposals++; }
  }
};
const texture = () => {
  const input = { disposals: 0, dispose() { this.disposals++; } };
  inputs.push(input);
  return input;
};
const owner = createEnvironmentOwner({ THREE, renderer: {}, scene });
assert.equal(owner.replace(texture()), true);
assert.equal(scene.environment, targets[0].texture);
assert.equal(owner.replace(texture()), true);
assert.equal(targets[0].disposals, 1);
assert.equal(targets[1].disposals, 0);
fail = true;
assert.throws(() => owner.replace(texture()), /conversion failed/);
assert.equal(scene.environment, targets[1].texture, 'failed optional HDR preserves the accepted fallback');
owner.dispose();
owner.dispose();
assert.equal(scene.environment, null);
assert.equal(targets[1].disposals, 1);
assert.equal(owner.replace(texture()), false, 'late callback cannot revive a retired scene');
assert.deepEqual(inputs.map(input => input.disposals), [1, 1, 1, 1]);
assert.equal(generatorDisposals, 3);
console.log('Environment outputs and transient inputs retain separate exactly-once ownership.');
